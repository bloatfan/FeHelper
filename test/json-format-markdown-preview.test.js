import {describe, expect, it} from 'vitest';
import {createFormatPage, readSource} from './json-format/runtime.js';

describe('JSON 节点 Markdown 预览', () => {
    it('format-lib 只在字符串节点上提供渲染入口', () => {
        const source = readSource('apps/json-format/format-lib.js');

        expect(source).toContain('let _isMarkdownRenderableNode = function (el)');
        expect(source).toContain("el.children('.string').length");
        expect(source).toContain('class="opt-md"');
        expect(source).toContain("'fh-json-markdown-preview'");
        expect(source).toContain('if (action.hasClass(\'opt-md\'))');
    });

    it('工具页监听预览事件并用安全渲染器输出 HTML', () => {
        const source = readSource('apps/json-format/index.js');

        expect(source).toContain("document.addEventListener('fh-json-markdown-preview', this.handleJsonMarkdownPreview)");
        expect(source).toContain("document.removeEventListener('fh-json-markdown-preview', this.handleJsonMarkdownPreview)");
        expect(source).toContain('renderInlineMarkdown(this.mdPreview.source, {breaks: true})');
        expect(source).toContain('MD_PREVIEW_MAX_SOURCE');
    });

    it('预览开启 GFM 换行，单个换行不会被折叠成空格', () => {
        const page = createFormatPage();
        let received = null;
        page.context.renderInlineMarkdown = (source, options) => {
            received = {source, options};
            return '<p>rendered</p>';
        };

        page.app.handleJsonMarkdownPreview({
            detail: {path: '$.a', source: '第一行\n第二行'}
        });

        expect(page.app.mdPreviewHtml).toBe('<p>rendered</p>');
        expect(received.options).toEqual({breaks: true});
        expect(received.source).toBe('第一行\n第二行');
    });

    it('默认使用宽屏展示，便于阅读长文', () => {
        const page = createFormatPage();
        expect(page.app.mdPreviewWide).toBe(true);
    });

    it('可以在标准宽度与宽屏之间切换，并记住偏好', () => {
        const page = createFormatPage();
        const stored = {};

        page.app.safeSetLocalStorage = (key, value) => { stored[key] = value; };
        page.app.mdPreviewWide = false;

        page.app.toggleMdPreviewWidth();
        expect(page.app.mdPreviewWide).toBe(true);
        expect(stored['jsonformat:md-preview-wide']).toBe(true);

        page.app.toggleMdPreviewWidth();
        expect(page.app.mdPreviewWide).toBe(false);
        expect(stored['jsonformat:md-preview-wide']).toBe(false);
    });

    it('收到事件后打开预览并保留 JSONPath', () => {
        const page = createFormatPage();
        page.context.renderInlineMarkdown = source => `<div class="md">${source}</div>`;

        page.app.handleJsonMarkdownPreview({
            detail: {
                path: '$.messages[0].content[0].text',
                source: '## 标题'
            }
        });

        expect(page.app.mdPreview.visible).toBe(true);
        expect(page.app.mdPreview.path).toBe('$.messages[0].content[0].text');
        expect(page.app.mdPreview.mode).toBe('preview');
        expect(page.app.mdPreview.tooLarge).toBe(false);
    });

    it('超大文本自动切到源码视图', () => {
        const page = createFormatPage();
        page.context.renderInlineMarkdown = source => source;

        page.app.handleJsonMarkdownPreview({
            detail: {
                path: '$.large',
                source: 'x'.repeat(300001)
            }
        });

        expect(page.app.mdPreview.visible).toBe(true);
        expect(page.app.mdPreview.tooLarge).toBe(true);
        expect(page.app.mdPreview.mode).toBe('source');
    });

    it('关闭预览后重置全部状态', () => {
        const page = createFormatPage();
        page.context.renderInlineMarkdown = source => source;

        page.app.handleJsonMarkdownPreview({detail: {path: '$.a', source: '文本'}});
        page.app.closeMdPreview();

        expect(page.app.mdPreview.visible).toBe(false);
        expect(page.app.mdPreview.path).toBe('');
        expect(page.app.mdPreview.source).toBe('');
        expect(page.app.mdPreview.mode).toBe('preview');
    });

    it('按 Escape 关闭预览', () => {
        const page = createFormatPage();
        page.context.renderInlineMarkdown = source => source;
        page.app.handleJsonMarkdownPreview({detail: {path: '$.a', source: '文本'}});

        page.app.handleGlobalKeydown({
            key: 'Escape',
            preventDefault() {},
            stopPropagation() {}
        });

        expect(page.app.mdPreview.visible).toBe(false);
    });
});