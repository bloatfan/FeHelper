import {describe, expect, it} from 'vitest';
import {createFormatPage, flush} from './runtime.js';

const large = JSON.stringify({payload: 'x'.repeat(600001), tail: ['complete']});

// 纯文本视图现在是按需写入 DOM 的：打开它才生成 #jfContent_pre 的内容，
// 这样大 JSON 首次格式化时不用白白渲染一份全文。
function readPlainText(page) {
    page.context.Formatter.setPlainJsonView(true);
    return page.node('jfContent_pre').textContent;
}

describe('#666: asynchronous automatic decoding must not blank or replace a newer result', () => {
    it('renders the original large JSON when URL decoding fails', async () => {
        const page = createFormatPage();
        page.app.autoDecode = true;
        page.context.JsonEnDecode.urlDecodeByFetch = async () => {throw new Error('fetch blocked');};
        await page.format(large);
        await flush();
        expect(readPlainText(page)).toBe(JSON.stringify(JSON.parse(large), null, 4));
        expect(page.app.jsonActionReady).toBe(true);
    });

    it.each(['', '{bad:', '{"latest":true}'])('ignores old decoded content after input becomes %j', async latest => {
        const page = createFormatPage();
        const pending = [];
        page.app.jsonLintSwitch = false;
        page.app.autoDecode = true;
        page.context.JsonEnDecode.urlDecodeByFetch = source => new Promise(resolve => pending.push(() => resolve(source)));
        await page.format(large);
        page.app.autoDecode = false;
        await page.format(latest);
        const before = {html: page.node('jfContent').innerHTML, plain: page.node('jfContent_pre').textContent};
        pending[0]();
        await flush();
        expect(page.node('jfContent').innerHTML).toBe(before.html);
        expect(page.node('jfContent_pre').textContent).toBe(before.plain);
    });

    it('falls back when automatic decoding introduces unescaped quotes', async () => {
        const page = createFormatPage();
        page.app.autoDecode = true;
        const value = {url: '%22', payload: 'x'.repeat(600001)};
        const source = JSON.stringify(value);
        page.context.JsonEnDecode.urlDecodeByFetch = async text => decodeURIComponent(text);
        await page.format(source);
        await flush();
        expect(readPlainText(page)).toBe(JSON.stringify(value, null, 4));
        // 解码引入未转义引号时必须回退到原始 JSON；jsonFormattedSource 保存的是其格式化版本
        expect(page.app.jsonFormattedSource).toBe(JSON.stringify(value, null, 4));
    });

    it('keeps derived actions aligned with a successful decoded result', async () => {
        const page = createFormatPage();
        page.app.autoDecode = true;
        page.context.JsonEnDecode.urlDecodeByFetch = async text => decodeURIComponent(text);
        await page.format('{"label":"%E4%B8%AD%E6%96%87"}');
        await flush();
        expect(JSON.parse(page.app.jsonFormattedSource)).toEqual({label: '中文'});
        expect(page.node('jfContent').innerHTML).toContain('中文');
    });
});
