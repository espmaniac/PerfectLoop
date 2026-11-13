import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('The offline app shell lists every application module and existing file', async () => {
    const source = await readFile(new URL('coi-serviceworker.js', root), 'utf8');
    const listed = [...source.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    const modules = (await readdir(new URL('js/', root))).filter(name => name.endsWith('.js')).map(name => `js/${name}`);
    for (const module of modules) assert(listed.includes(module), `${module} is missing from PRECACHE`);
    for (const path of listed.filter(path => path !== './')) await stat(new URL(path, root));
    const page = await readFile(new URL('index.html', root), 'utf8');
    for (const [, path] of page.matchAll(/(?:href|src)="\.\/([^"?#]+)/g)) assert(listed.includes(path), `${path} from index.html is missing from PRECACHE`);
    assert(!listed.some(path => path.includes('ffmpeg-core')), 'The engine core has its own verified store');
    // Every module the app imports at startup must be available offline.
    const pending = ['js/start.js', 'js/app.js'], seen = new Set();
    while (pending.length) {
        const path = pending.pop();
        if (seen.has(path)) continue;
        seen.add(path);
        assert(listed.includes(path), `${path} is imported at startup but missing from PRECACHE`);
        const code = await readFile(new URL(path, root), 'utf8');
        for (const [, specifier] of code.matchAll(/^(?:import|export)\b[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm))
            pending.push(new URL(specifier, new URL(path, root)).href.slice(root.href.length));
    }
    assert(seen.has('vendor/ffmpeg/classes.js'));
});
