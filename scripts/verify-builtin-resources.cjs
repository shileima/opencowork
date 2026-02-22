/**
 * Verification script for built-in resources (Skills and MCP)
 * This script checks if the resources are correctly configured for both dev and production
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('OpenCowork Built-in Resources Verification');
console.log('='.repeat(60));

// Check Skills
console.log('\n📁 Checking Skills...');

const skillsPath = path.join(__dirname, '../resources/skills');
if (!fs.existsSync(skillsPath)) {
    console.error('❌ Skills directory not found:', skillsPath);
    process.exit(1);
}

const skillDirs = fs.readdirSync(skillsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

console.log(`✅ Found ${skillDirs.length} skill directories`);

let validSkills = 0;
let invalidSkills = [];

for (const skillName of skillDirs) {
    const skillMdPath = path.join(skillsPath, skillName, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        if (content.includes('name:') && content.includes('description:')) {
            validSkills++;
            console.log(`   ✓ ${skillName}`);
        } else {
            invalidSkills.push(`${skillName} (missing frontmatter)`);
            console.log(`   ⚠ ${skillName} - incomplete frontmatter`);
        }
    } else {
        invalidSkills.push(`${skillName} (no SKILL.md)`);
        console.log(`   ⚠ ${skillName} - missing SKILL.md`);
    }
}

console.log(`\n✅ Valid skills: ${validSkills}/${skillDirs.length}`);
if (invalidSkills.length > 0) {
    console.log('⚠️  Invalid skills:', invalidSkills.join(', '));
}

// Check MCP Config
console.log('\n🔌 Checking MCP Configuration...');

const builtinMcpPath = path.join(__dirname, '../resources/mcp/builtin-mcp.json');
if (fs.existsSync(builtinMcpPath)) {
    console.log('✅ Built-in MCP configuration file found');
    try {
        const mcpConfig = JSON.parse(fs.readFileSync(builtinMcpPath, 'utf-8'));
        const serverCount = Object.keys(mcpConfig.mcpServers || {}).length;
        console.log(`   ✓ Found ${serverCount} built-in MCP servers in config file`);
        console.log(`   ✓ Servers: ${Object.keys(mcpConfig.mcpServers || {}).join(', ')}`);
    } catch (e) {
        console.error('   ❌ Error parsing builtin-mcp.json:', e.message);
    }
} else {
    console.error('❌ Built-in MCP configuration file not found at:', builtinMcpPath);
}

const mcpServicePath = path.join(__dirname, '../electron/agent/mcp/MCPClientService.ts');
let mcpContent = '';
if (fs.existsSync(mcpServicePath)) {
    mcpContent = fs.readFileSync(mcpServicePath, 'utf-8');

    // Check for loadBuiltinMCPConfig method
    if (mcpContent.includes('loadBuiltinMCPConfig')) {
        console.log('✅ MCPClientService has loadBuiltinMCPConfig method');
    } else {
        console.log('⚠️  MCPClientService missing loadBuiltinMCPConfig method');
    }

    // Check for DEFAULT_MCP_CONFIGS fallback
    if (mcpContent.includes('DEFAULT_MCP_CONFIGS')) {
        console.log('✅ DEFAULT_MCP_CONFIGS fallback found in MCPClientService');
    }
} else {
    console.error('❌ MCPClientService.ts not found');
}

// Check electron-builder config
console.log('\n📦 Checking electron-builder configuration...');

const builderConfigPath = path.join(__dirname, '../electron-builder.json5');
if (!fs.existsSync(builderConfigPath)) {
    console.error('❌ electron-builder.json5 not found');
    process.exit(1);
}

const builderConfig = fs.readFileSync(builderConfigPath, 'utf-8');

if (builderConfig.includes('resources/skills')) {
    console.log('✅ Skills directory included in extraResources');
} else {
    console.error('❌ Skills directory NOT included in extraResources');
}

if (builderConfig.includes('resources/mcp')) {
    console.log('✅ MCP directory included in extraResources');
} else {
    console.error('❌ MCP directory NOT included in extraResources');
}

// Check project template
console.log('\n📄 Checking project template...');

const templatePath = path.join(__dirname, '../resources/templates/react-vite');
if (fs.existsSync(templatePath)) {
    const requiredFiles = ['package.json', 'index.html', 'vite.config.ts', 'src/main.tsx', 'src/App.tsx'];
    const missingFiles = requiredFiles.filter(f => !fs.existsSync(path.join(templatePath, f)));
    if (missingFiles.length === 0) {
        console.log('✅ Project template (react-vite) found with required files');
    } else {
        console.error('❌ Project template missing files:', missingFiles.join(', '));
    }
} else {
    console.error('❌ Project template not found at:', templatePath);
}

if (builderConfig.includes('resources/templates')) {
    console.log('✅ Templates directory included in extraResources');
} else {
    console.error('❌ Templates directory NOT included in extraResources');
}

if (builderConfig.includes('resources/playwright') || builderConfig.includes('playwright/package')) {
    console.log('✅ Playwright package included in extraResources');
} else {
    console.warn('⚠️  Playwright package NOT included in extraResources');
}

// Check SkillManager implementation
console.log('\n🔍 Checking SkillManager implementation...');

const skillManagerPath = path.join(__dirname, '../electron/agent/skills/SkillManager.ts');
if (!fs.existsSync(skillManagerPath)) {
    console.error('❌ SkillManager.ts not found');
    process.exit(1);
}

const skillManagerContent = fs.readFileSync(skillManagerPath, 'utf-8');

const checks = [
    { name: 'initializeDefaults method', pattern: /async initializeDefaults/ },
    { name: 'Multiple path checking', pattern: /possiblePaths/ },
    { name: 'Production path handling', pattern: /process\.resourcesPath/ },
    { name: 'Development path handling', pattern: /process\.cwd\(\)/ },
    { name: 'Recursive copy', pattern: /recursive:\s*true/ }
];

let skillManagerChecks = 0;
for (const check of checks) {
    if (skillManagerContent.match(check.pattern)) {
        console.log(`   ✓ ${check.name}`);
        skillManagerChecks++;
    } else {
        console.log(`   ⚠️  ${check.name} - NOT FOUND`);
    }
}

console.log(`\n✅ SkillManager checks: ${skillManagerChecks}/${checks.length}`);

// Check built-in Node.js 20
console.log('\n📦 Checking built-in Node.js 20...');

const NODE_EXPECTED_MAJOR = 20;
const nodeResourcesPath = path.join(__dirname, '../resources/node');
const platform = process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const platformKey = platform === 'win32' ? 'win32-x64' : `${platform}-${arch}`;
const nodeDir = path.join(nodeResourcesPath, platformKey);
const nodeExe = platform === 'win32' ? 'node.exe' : 'node';
const nodePath = path.join(nodeDir, nodeExe);

let nodeCheckPassed = false;
if (fs.existsSync(nodePath)) {
    try {
        const { execSync } = require('child_process');
        const versionOutput = execSync(`"${nodePath}" --version`, { encoding: 'utf-8' }).trim();
        const match = versionOutput.match(/^v?(\d+)\./);
        const major = match ? parseInt(match[1], 10) : 0;
        if (major === NODE_EXPECTED_MAJOR) {
            console.log(`✅ Built-in Node.js ${versionOutput} found (${platformKey})`);
            nodeCheckPassed = true;
        } else {
            console.warn(`⚠️  Built-in Node.js version ${versionOutput} (expected v${NODE_EXPECTED_MAJOR}.x.x)`);
        }
    } catch (e) {
        console.warn(`⚠️  Built-in Node.js exists but failed to run: ${e.message}`);
    }
} else {
    console.warn(`⚠️  Built-in Node.js not found at ${nodePath}`);
    console.warn('   Run: node scripts/download-node.mjs');
}

// Check built-in pnpm (required for installer: 整包 pnpm/ 含 bin+dist，直接 .app 或 DMG 均可找到)
const pnpmBinPath = path.join(nodeDir, 'pnpm', 'bin', 'pnpm.cjs');
const pnpmDistPath = path.join(nodeDir, 'pnpm', 'dist');
let pnpmCheckPassed = false;
if (fs.existsSync(pnpmBinPath) && fs.existsSync(pnpmDistPath)) {
    console.log('✅ Built-in pnpm (pnpm/bin+dist) found - deploy will use built-in Node + pnpm');
    pnpmCheckPassed = true;
} else if (nodeCheckPassed) {
    console.warn('⚠️  Built-in pnpm not found at', path.join(nodeDir, 'pnpm'));
    console.warn('   Run: node scripts/prepare-pnpm.mjs (deploy will fallback to system npx)');
}

// Check Playwright package (browsers 不再打包，首次运行时下载到 userData)
console.log('\n🌐 Checking Playwright...');

const playwrightPackagePath = path.join(__dirname, '../resources/playwright/package');

if (fs.existsSync(playwrightPackagePath)) {
    const pkgJsonPath = path.join(playwrightPackagePath, 'playwright', 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
        console.log('✅ Playwright package found (browsers will be downloaded at first run)');
    } else {
        console.warn('⚠️  Playwright package directory exists but playwright/package.json not found');
    }
} else {
    console.warn('⚠️  Playwright package not found - run: npm run prepare:playwright');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 SUMMARY');
console.log('='.repeat(60));

const totalChecks = 4 + checks.length;
let passedChecks = 0;

if (validSkills > 0) passedChecks++;
if (mcpContent.includes('DEFAULT_MCP_CONFIGS')) passedChecks++;
if (builderConfig.includes('resources/skills')) passedChecks++;
if (nodeCheckPassed) passedChecks++;
passedChecks += skillManagerChecks;

const percentage = Math.round((passedChecks / totalChecks) * 100);

console.log(`Overall: ${passedChecks}/${totalChecks} checks passed (${percentage}%)`);

// Allow build to continue if percentage >= 75% (warnings are acceptable)
// Only fail if there are critical errors (percentage < 75%)
if (percentage === 100) {
    console.log('\n✅ All checks passed! Built-in resources are properly configured.');
} else if (percentage >= 75) {
    console.log('\n⚠️  Some warnings detected, but build will continue.');
} else {
    console.log('\n❌ Critical errors detected. Please review the output above.');
    process.exit(1);
}

if (nodeCheckPassed) {
    console.log('   • Built-in Node.js 20 is ready for deploy and run_command');
} else {
    console.log('   • Run "node scripts/download-node.mjs" to build with built-in Node.js');
}

console.log('\n📝 Expected behavior:');
console.log('   • Skills will be copied to ~/.qa-cowork/skills on first run');
console.log('   • MCP servers will be loaded from resources/mcp/builtin-mcp.json');
console.log('   • Built-in MCP servers are automatically added/updated on each startup');
console.log('   • User-disabled servers will be preserved, but configs are updated');
console.log('   • Works in both development and production (packaged) mode');
console.log('\n📦 Packaging:');
console.log('   • Skills are included in installer as extraResources');
console.log('   • MCP configs are included in installer as extraResources');
console.log('   • Green version (portable) works the same way');

// 打安装包前必须通过的内置资源检查（缺一不可，否则安装包内部署会失败）
console.log('\n📋 Required for installer (must pass before packaging):');
const requiredOk = nodeCheckPassed && pnpmCheckPassed;
if (requiredOk) {
    console.log('   ✅ Built-in Node.js 20');
    console.log('   ✅ Built-in pnpm (pnpm/bin+dist)');
    console.log('   → Ready to build installer.');
} else {
    console.log('   ❌ Missing required built-in resources for installer.');
    if (!nodeCheckPassed) {
        console.log('   • Built-in Node.js: run  node scripts/download-node.mjs');
    }
    if (!pnpmCheckPassed) {
        console.log('   • Built-in pnpm:     run  node scripts/prepare-pnpm.mjs');
    }
    console.log('\n   Then run  pnpm run build  again.');
    process.exit(1);
}
process.exit(0);
