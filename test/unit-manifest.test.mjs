import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import { spawnSync } from 'child_process'
import chromeManifest from '../src/chromeManifest.mjs'


//規則R10: 下載清單釘選commit, 各片大小與SHA-256等於受版控之chrome/portable.zip.00N; 釘選commit之chrome/樹等於HEAD(分片未被改)


describe('unit-manifest', function() {

    it('url is pinned to a commit, not a branch', function() {
        assert.ok(/^[0-9a-f]{40}$/.test(chromeManifest.commit))
        assert.ok(chromeManifest.urlBase.includes(`/raw/${chromeManifest.commit}/chrome/`))
        assert.ok(!/refs\/heads|master/.test(chromeManifest.urlBase))
    })

    it('shard sizes and sha256 equal the tracked files', function() {
        assert.strict.equal(chromeManifest.shards.length, 8)
        for (let s of chromeManifest.shards) {
            let b = fs.readFileSync(path.resolve('./chrome', s.fn))
            assert.strict.equal(b.length, s.size, s.fn)
            assert.strict.equal(crypto.createHash('sha256').update(b).digest('hex'), s.sha256, s.fn)
        }
        assert.strict.equal(fs.readFileSync(path.resolve('./chrome/ver.txt'), 'utf8').trim(), chromeManifest.verChrome)
    })

    it('pinned commit has the same chrome tree as HEAD and tracked shards are unmodified', function() {
        let a = spawnSync('git', ['ls-tree', chromeManifest.commit, 'chrome/'], { encoding: 'utf8' })
        if (a.status !== 0) {
            this.skip() //無git或非repo(如由npm安裝之套件)
        }
        let b = spawnSync('git', ['ls-tree', 'HEAD', 'chrome/'], { encoding: 'utf8' })
        assert.strict.equal(a.stdout, b.stdout)
        let st = spawnSync('git', ['status', '--porcelain', '--', 'chrome/'], { encoding: 'utf8' })
        assert.strict.equal(st.stdout.trim(), '')
    })

})
