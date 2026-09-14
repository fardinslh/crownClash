import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

test('frontend Docker packaging includes authoritative battlefield JSON before build', () => {
  const dockerfilePath = path.join(REPO_ROOT, 'apps/game/Dockerfile');
  assert.ok(fs.existsSync(dockerfilePath), 'apps/game/Dockerfile must exist');

  const authoritativeJsonPath = path.join(REPO_ROOT, 'apps/server-nakama/battlefields.json');
  assert.ok(fs.existsSync(authoritativeJsonPath), 'apps/server-nakama/battlefields.json must exist as single authoritative source');

  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
  const lines = dockerfileContent.split(/\r?\n/);

  // Parse Dockerfile stages and locate build stage
  let inBuildStage = false;
  let copyBattlefieldsLineIndex = -1;
  let runBuildLineIndex = -1;
  let copyBattlefieldsInstruction = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/^FROM\s+.*\s+AS\s+build\b/i.test(line)) {
      inBuildStage = true;
      continue;
    }

    if (inBuildStage && /^FROM\s+/i.test(line)) {
      // Transitioned to next stage (e.g. production nginx stage)
      inBuildStage = false;
      continue;
    }

    if (!inBuildStage) {
      continue;
    }

    // Check for build command
    if (/^RUN\s+npm\s+run\s+build\b/.test(line)) {
      runBuildLineIndex = i;
    }

    // Check for battlefield JSON copy instruction
    const copyMatch = /^COPY\s+(\S+)\s+(\S+)/.exec(line);
    if (copyMatch) {
      const src = copyMatch[1];
      const dest = copyMatch[2];

      if (src.includes('battlefields.json')) {
        copyBattlefieldsLineIndex = i;
        copyBattlefieldsInstruction = { src, dest, line };
      }

      // Requirement 3: Do not copy the entire server source into the frontend image
      assert.ok(
        !/apps\/server-nakama(\/|\s|$)/.test(src) || src === 'apps/server-nakama/battlefields.json',
        `Forbidden broad copy instruction: "${line}". Do not copy entire server-nakama directory into frontend image.`
      );
      assert.ok(
        !/^apps\/?\s/.test(src),
        `Forbidden broad copy instruction: "${line}". Do not copy entire apps directory into frontend image.`
      );
    }
  }

  // Verify COPY instruction exists in the build stage
  assert.ok(
    copyBattlefieldsInstruction !== null,
    'apps/game/Dockerfile build stage must contain a COPY instruction for apps/server-nakama/battlefields.json'
  );

  // Verify source matches authoritative file relative to build context (repo root)
  assert.equal(
    copyBattlefieldsInstruction.src,
    'apps/server-nakama/battlefields.json',
    'COPY source path must be "apps/server-nakama/battlefields.json"'
  );

  // Verify destination path matches matching path
  const normalizedDest = copyBattlefieldsInstruction.dest.replace(/^\.\//, '');
  assert.equal(
    normalizedDest,
    'apps/server-nakama/battlefields.json',
    'COPY destination path must match "apps/server-nakama/battlefields.json"'
  );

  // Verify COPY instruction appears strictly before "RUN npm run build"
  assert.ok(
    runBuildLineIndex !== -1,
    'apps/game/Dockerfile build stage must contain "RUN npm run build"'
  );
  assert.ok(
    copyBattlefieldsLineIndex < runBuildLineIndex,
    `COPY instruction on line ${copyBattlefieldsLineIndex + 1} must appear before "RUN npm run build" on line ${runBuildLineIndex + 1}`
  );

  // Verify resolution against game-core import path inside the container
  const gameCoreBattlefieldsTs = path.join(REPO_ROOT, 'packages/game-core/src/battlefields.ts');
  const sourceCode = fs.readFileSync(gameCoreBattlefieldsTs, 'utf8');
  const importMatch = /import\s+rawBattlefields\s+from\s+['"]([^'"]+)['"]/.exec(sourceCode);
  assert.ok(importMatch, 'packages/game-core/src/battlefields.ts must import rawBattlefields');

  const relativeImport = importMatch[1];
  // Inside container, WORKDIR is /app, so file is at /app/packages/game-core/src/battlefields.ts
  const simulatedContainerDir = '/app/packages/game-core/src';
  const resolvedContainerPath = path.posix.normalize(path.posix.join(simulatedContainerDir, relativeImport));

  assert.equal(
    resolvedContainerPath,
    '/app/apps/server-nakama/battlefields.json',
    `Resolved import in container "${resolvedContainerPath}" must match copied file "/app/apps/server-nakama/battlefields.json"`
  );
});
