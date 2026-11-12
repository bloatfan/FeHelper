import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const utils = require('../apps/json-format/json-auto-utils.js');
const source = fs.readFileSync(new URL('../apps/json-format/format-lib.js', import.meta.url), 'utf8');

function largeView(value, constantOverrides) {
    const buttons = [];
    const calls = [];
    const wrap = () => {
        const result = {html() { return result; }, empty() {}, text() {}};
        return result;
    };
    const context = vm.createContext({
        window: {FHJsonAutoUtils: utils},
        cachedJsonValue: value, cachedJsonString: utils.safeStringify(value, 4),
        largeJsonPlainViewEnabled: true, largeJsonNodeViewEnabled: false, escapeJsonStringEnabled: true,
        LARGE_JSON_AUTO_TREE_CHAR_LIMIT: 8000000,
        LARGE_JSON_AUTO_TREE_NODE_LIMIT: 4000,
        LARGE_JSON_NODE_LIMIT: 100000,
        LARGE_JSON_CHAR_LIMIT: 16000000,
        LARGE_JSON_DEPTH_LIMIT: 100,
        LARGE_JSON_ABSOLUTE_CHAR_LIMIT: 32000000,
        LARGE_JSON_ABSOLUTE_NODE_LIMIT: 2000000,
        LARGE_JSON_PLAIN_PREVIEW_LIMIT: 2000000,
        LAZY_TREE_CHILD_LIMIT: 200,
        LAZY_TREE_DEPTH_LIMIT: 2,
        lazyTreeEnabled: false,
        complexityCache: null, jfPreSource: null, plainViewBannerEl: null,
        ...(constantOverrides || {}),
        formattingMsg: {hide() {}}, jfPre: wrap(), jfContent: wrap(),
        _syncPlainJsonPreview() { return {text: '', truncated: false, total: 0}; },
        _canRenderFormattedResult: () => true,
        _clearOptionBar() {}, _buildOptionBar() { calls.push('toolbar'); },
        _addEvents() { calls.push('events'); }, _downloadSupport() { calls.push('download'); },
        _clearJsonSearch() { calls.push('search'); }, _emitFormatReady() { calls.push('ready'); },
        _setPlainJsonView(enabled) { calls.push(enabled ? 'plain' : 'tree'); },
        formatJsonToHtml(value) { calls.push('render'); return utils.safeStringify(value); },
        toast(message) { calls.push(message); },
        $(html) {
            const el = {html() {}, hide() {}, prependTo() {return el;}, appendTo() {return el;}, bind(event, handler) {el.click = handler;}};
            if (html.includes('fh-json-large-tree')) buttons.push(el);
            return el;
        }
    });
    const start = source.indexOf('    let _getJsonComplexity = function');
    const end = source.indexOf('    /**', start);
    vm.runInContext(source.slice(start, end), context);
    return {context, calls, buttons, run(code) {return vm.runInContext(code, context);}};
}

describe('#658: opt into a bounded node view for large JSON', () => {
    it('offers node actions after a large but bounded result, without dropping data', () => {
        const value = {payload: 'x'.repeat(640000), tail: {id: 1234567890123456789n}};
        const view = largeView(value);
        view.run('_renderLargeJsonPlainView()');
        expect(view.buttons).toHaveLength(1);
        view.buttons[0].click({preventDefault() {}, stopPropagation() {}});
        expect(view.calls).toContain('render');
        expect(view.calls.slice(-5)).toEqual(['toolbar', 'events', 'download', 'search', 'ready']);
        expect(view.context.largeJsonPlainViewEnabled).toBe(false);
        expect(view.context.largeJsonNodeViewEnabled).toBe(true);
        expect(view.context.escapeJsonStringEnabled).toBe(true);
        expect(view.context.cachedJsonString).toContain('1234567890123456789');
        expect(view.context.cachedJsonValue).toBe(value);
    });

    it.each([
        [Array(3001).fill(1), {LARGE_JSON_ABSOLUTE_NODE_LIMIT: 3000}],
        [Array.from({length: 102}).reduce(value => ({child: value}), {}), {}],
        ['x'.repeat(2000), {LARGE_JSON_ABSOLUTE_CHAR_LIMIT: 1000}]
    ])('refuses absolute over-budget data instead of offering a dead tree button', (value, overrides) => {
        const view = largeView(value, overrides);
        view.run('_renderLargeJsonPlainView()');
        expect(view.buttons).toHaveLength(0);
        expect(view.run('_renderLargeJsonTree(true)')).toBe(false);
        expect(view.calls).not.toContain('render');
        expect(view.context.largeJsonPlainViewEnabled).toBe(true);
    });

    it('renders text-heavy large JSON directly instead of falling back to plain text', () => {
        const value = {payload: 'x'.repeat(900000)};
        const view = largeView(value);
        expect(view.run('_shouldUseLargeJsonPlainView(cachedJsonValue, cachedJsonString)')).toBe(false);
    });

    it('does not fall back to plain text just because there are many nodes', () => {
        const view = largeView(Array(5000).fill(1));
        expect(view.run('_shouldUseLargeJsonPlainView(cachedJsonValue, cachedJsonString)')).toBe(false);
        expect(view.run('_shouldRenderLazyTree(cachedJsonValue, cachedJsonString)')).toBe(true);
    });

    it('keeps small JSON on the eager path', () => {
        const view = largeView({a: 1, b: [1, 2, 3]});
        expect(view.run('_shouldRenderLazyTree(cachedJsonValue, cachedJsonString)')).toBe(false);
    });

    it('uses the lazy renderer for large trees and restores the flag afterwards', () => {
        const view = largeView({payload: 'x'.repeat(2000)});
        view.run('_renderLargeJsonTree(true)');
        expect(view.calls).toContain('render');
        expect(view.context.lazyTreeEnabled).toBe(false);
    });

    it('retains complete plaintext if tree construction fails', () => {
        const view = largeView({payload: 'x'.repeat(640000)});
        const original = view.context.cachedJsonString;
        view.context.formatJsonToHtml = () => {throw new Error('render failed');};
        expect(view.run('_renderLargeJsonTree()')).toBe(false);
        expect(view.context.largeJsonPlainViewEnabled).toBe(true);
        expect(view.context.cachedJsonString).toBe(original);
        expect(view.context.escapeJsonStringEnabled).toBe(true);
    });

    it('measures complexity once per value and length', () => {
        const view = largeView({a: 1});
        let calls = 0;
        view.context.window.FHJsonAutoUtils = {
            measureJsonComplexity() {
                calls += 1;
                return {characters: 1, nodes: 1, depth: 1, truncated: false};
            }
        };
        view.run('_getJsonComplexity(cachedJsonValue, cachedJsonString.length)');
        view.run('_getJsonComplexity(cachedJsonValue, cachedJsonString.length)');
        expect(calls).toBe(1);
    });

    it('keeps automatic rendering conservative while allowing a bounded explicit switch', () => {
        const value = {payload: 'x'.repeat(640000)};
        expect(utils.shouldUsePlainJsonView(value, 640000, {characterLimit: 600000})).toBe(true);
        expect(largeView(value).run('_canRenderLargeJsonTree()')).toBe(true);
    });
});

it('enables node actions for an explicitly opened large tree without changing the saved status-bar setting', () => {
    let visible = false;
    const menu = {length: 1, show() {visible = true;}};
    const context = vm.createContext({
        statusBarEnabled: false, largeJsonNodeViewEnabled: false,
        el: {children: () => menu},
        $: () => ({hide() {visible = false;}})
    });
    const start = source.indexOf('    let _addOptForItem = function');
    const end = source.indexOf('    let _handleNodeOptionClick', start);
    vm.runInContext(source.slice(start, end) + '\n_addOptForItem(el, true);', context);
    expect(visible).toBe(false);
    context.largeJsonNodeViewEnabled = true;
    vm.runInContext('_addOptForItem(el, true)', context);
    expect(visible).toBe(true);
    expect(context.statusBarEnabled).toBe(false);
});
