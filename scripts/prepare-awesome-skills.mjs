#!/usr/bin/env node
/**
 * 准备 awesome-claude-skills
 * 从 GitHub 下载并集成到客户端内置资源中
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'resources', 'skills');
const awesomeSkillsDir = path.join(resourcesDir, 'awesome-claude-skills');

// awesome-claude-skills 仓库信息
const AWESOME_SKILLS_REPO = 'https://github.com/ComposioHQ/awesome-claude-skills.git';
const AWESOME_SKILLS_BRANCH = 'master';

console.log('🚀 开始准备 awesome-claude-skills...\n');

// 检查并创建目录
if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
    console.log(`✅ 创建资源目录: ${resourcesDir}`);
}

// 临时克隆目录
const tempCloneDir = path.join(projectRoot, '.temp-awesome-skills');

try {
    // 如果临时目录存在，先删除
    if (fs.existsSync(tempCloneDir)) {
        console.log('🧹 清理临时目录...');
        fs.rmSync(tempCloneDir, { recursive: true, force: true });
    }

    // 克隆仓库
    console.log(`📥 正在克隆 awesome-claude-skills 仓库...`);
    console.log(`   仓库: ${AWESOME_SKILLS_REPO}`);
    console.log(`   分支: ${AWESOME_SKILLS_BRANCH}`);
    
    execSync(`git clone --depth 1 --branch ${AWESOME_SKILLS_BRANCH} ${AWESOME_SKILLS_REPO} "${tempCloneDir}"`, {
        stdio: 'inherit',
        cwd: projectRoot
    });

    console.log('\n✅ 仓库克隆完成\n');

    // awesome-claude-skills 的技能直接在根目录下
    // 需要排除的文件和目录
    const excludeItems = [
        '.git',
        '.github',
        '.claude-plugin',
        'README.md',
        'CONTRIBUTING.md',
        'LICENSE',
        '.gitignore',
        '.gitattributes',
        'connect',  // 这是插件，不是技能
        'connect-apps',  // 这是插件，不是技能
        'connect-apps-plugin',  // 这是插件，不是技能
        'document-skills',  // 这是文档集合，不是单个技能
        'skill-share',  // 这是工具，不是技能
    ];
    
    // 确保目标目录存在
    if (fs.existsSync(awesomeSkillsDir)) {
        console.log('🧹 清理现有 awesome-claude-skills 目录...');
        fs.rmSync(awesomeSkillsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(awesomeSkillsDir, { recursive: true });

    // 读取根目录下的所有目录
    const rootDirs = fs.readdirSync(tempCloneDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && !excludeItems.includes(dirent.name))
        .map(dirent => dirent.name);
    
    console.log(`📋 找到 ${rootDirs.length} 个技能目录\n`);

    let copiedCount = 0;
    let skippedCount = 0;

    // 复制每个技能
    for (const skillName of rootDirs) {
        const sourcePath = path.join(tempCloneDir, skillName);
        const targetPath = path.join(awesomeSkillsDir, skillName);

        try {
            // 检查是否有 SKILL.md 文件
            const skillMdPath = path.join(sourcePath, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) {
                console.log(`⏭️  跳过 ${skillName} (缺少 SKILL.md)`);
                skippedCount++;
                continue;
            }

            // 复制整个技能目录
            fs.cpSync(sourcePath, targetPath, { recursive: true });
            console.log(`✅ 已复制: ${skillName}`);
            copiedCount++;
        } catch (error) {
            console.error(`❌ 复制 ${skillName} 失败:`, error.message);
            skippedCount++;
        }
    }

    console.log(`\n📊 统计:`);
    console.log(`   ✅ 成功复制: ${copiedCount} 个技能`);
    console.log(`   ⏭️  跳过: ${skippedCount} 个技能`);
    console.log(`\n✅ awesome-claude-skills 准备完成！`);
    console.log(`   目标目录: ${awesomeSkillsDir}`);

} catch (error) {
    console.error('\n❌ 错误:', error.message);
    if (error.stderr) {
        console.error('错误详情:', error.stderr.toString());
    }
    process.exit(1);
} finally {
    // 清理临时目录
    if (fs.existsSync(tempCloneDir)) {
        console.log('\n🧹 清理临时目录...');
        fs.rmSync(tempCloneDir, { recursive: true, force: true });
    }
}
