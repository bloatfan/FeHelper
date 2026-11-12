import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createFormatPage } from './json-format/runtime.js';

const ROOT = new URL('../', import.meta.url);
const formatLibSource = fs.readFileSync(new URL('apps/json-format/format-lib.js', ROOT), 'utf8');

describe('large JSON opens as a bounded, lazily expanded tree', () => {
    it('renders a bounded window with a "load more" affordance instead of every node', async () => {
        const page = createFormatPage();
        const items = Array.from({ length: 20001 }, (_, index) => ({ index, name: 'user-' + index }));
        await page.format(JSON.stringify({ items }));

        const html = page.node('jfContent').innerHTML;
        expect(html).toContain('fh-lazy');
        expect(html).toContain('还有 19,801 项');
        // 只铺开固定窗口，HTML 体量与原数据规模无关
        expect(html.length).toBeLessThan(400000);
        expect(html).not.toContain('user-20000');
        // 纯文本视图按需生成，首次格式化不重复渲染全文
        expect(page.node('jfContent_pre').textContent).toBe('');
    });

    it('keeps small JSON fully expanded (no lazy placeholders)', async () => {
        const page = createFormatPage();
        await page.format(JSON.stringify({ a: { b: 1 }, list: [1, 2, 3] }));

        const html = page.node('jfContent').innerHTML;
        expect(html).toContain('class="key">b<');
        expect(html).not.toContain('fh-lazy');
        expect(html).not.toContain('fh-lazy-more');
    });

    it('parses the input once instead of once per pipeline stage', async () => {
        const page = createFormatPage();
        const utils = page.context.FHJsonAutoUtils;
        const original = utils.parseWithBigInt;
        let calls = 0;
        utils.parseWithBigInt = (...args) => {
            calls += 1;
            return original(...args);
        };

        await page.format(JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => i) }));
        expect(calls).toBe(1);
    });

    it('keeps the complete text available for copy/download even though the tree is truncated', async () => {
        const page = createFormatPage();
        const text = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => i) }, null, 4);
        await page.format(text);

        // 切到纯文本视图时才生成全文预览
        page.context.Formatter.setPlainJsonView(true);
        expect(page.node('jfContent_pre').textContent).toBe(text);
    });
});

describe('plain-text fallback preview is capped', () => {
    function buildPreview(source) {
        const start = formatLibSource.indexOf('    let _buildPlainJsonPreview = function');
        const end = formatLibSource.indexOf('    let _syncPlainJsonPreview', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const sandbox = {
            cachedJsonString: source,
            LARGE_JSON_PLAIN_PREVIEW_LIMIT: 1000
        };
        vm.createContext(sandbox);
        vm.runInContext(formatLibSource.slice(start, end) + '\nresult = _buildPlainJsonPreview();', sandbox);
        return sandbox.result;
    }

    it('does not put the whole document into the DOM', () => {
        const preview = buildPreview('x'.repeat(5000));
        expect(preview.truncated).toBe(true);
        expect(preview.total).toBe(5000);
        expect(preview.text.length).toBeLessThan(1200);
        expect(preview.text).toContain('已截断预览');
        expect(preview.text).toContain('5,000');
    });

    it('leaves small documents untouched', () => {
        const preview = buildPreview('{ "a": 1 }');
        expect(preview.truncated).toBe(false);
        expect(preview.text).toBe('{ "a": 1 }');
    });
});