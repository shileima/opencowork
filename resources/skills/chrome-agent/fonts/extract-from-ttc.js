#!/usr/bin/env node
/**
 * 从 Homebrew 安装的 TTC 文件中提取单个 TTF 字体
 */

const fontkit = require('fontkit');
const fs = require('fs');
const path = require('path');

const TTC_PATH = path.join(process.env.HOME, 'Library/Fonts/NotoSansCJK.ttc');
const OUTPUT_DIR = path.join(__dirname);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'NotoSansCJK-SC-Regular.ttf');

console.log('📦 从 TTC 提取字体...');
console.log(`   来源: ${TTC_PATH}`);
console.log(`   目标: ${OUTPUT_FILE}`);

if (!fs.existsSync(TTC_PATH)) {
  console.error(`❌ TTC 文件不存在: ${TTC_PATH}`);
  process.exit(1);
}

try {
  const collection = fontkit.openSync(TTC_PATH);
  
  // 查找简体中文 Regular 字体
  const font = collection.fonts.find(f => 
    f.postscriptName && f.postscriptName === 'NotoSansCJKsc-Regular'
  ) || collection.fonts[27]; // 索引 27 是 NotoSansCJKsc-Regular
  
  if (!font) {
    throw new Error('未找到 NotoSansCJKsc-Regular 字体');
  }
  
  console.log(`✅ 找到字体: ${font.postscriptName || font.fullName}`);
  
  // 直接使用字体的 stream 来保存
  // 注意：这可能需要特殊处理
  try {
    // 尝试创建包含常用字符的子集
    const subset = font.createSubset();
    
    // 添加 ASCII
    for (let i = 32; i <= 126; i++) {
      try {
        const glyph = font.getGlyph(i);
        if (glyph) subset.includeGlyph(glyph);
      } catch (e) {}
    }
    
    // 添加常用中文标点
    const punctuation = '，。！？；：、""\'\'（）【】《》';
    for (const char of punctuation) {
      try {
        const codePoint = char.codePointAt(0);
        const glyph = font.getGlyph(codePoint);
        if (glyph) subset.includeGlyph(glyph);
      } catch (e) {}
    }
    
    // 添加常用中文字符（CJK Unified Ideographs）
    // 限制数量以避免内存问题
    let count = 0;
    for (let cp = 0x4e00; cp <= 0x9fff && count < 3000; cp++) {
      try {
        const glyph = font.getGlyph(cp);
        if (glyph) {
          subset.includeGlyph(glyph);
          count++;
        }
      } catch (e) {
        // 忽略不存在的字符
      }
    }
    
    console.log(`   包含字符数: ${subset.glyphs.length}`);
    
    // 编码字体
    const buffer = subset.encode();
    fs.writeFileSync(OUTPUT_FILE, buffer);
    
    console.log(`✅ 字体提取成功！`);
    console.log(`   文件: ${OUTPUT_FILE}`);
    console.log(`   大小: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    
  } catch (subsetError) {
    console.error(`⚠️  子集提取失败: ${subsetError.message}`);
    console.error(`   尝试直接保存字体流...`);
    
    // 备用方法：尝试直接保存字体数据
    // 注意：这可能不工作，因为 TTC 中的字体不是独立的
    throw subsetError;
  }
  
} catch (error) {
  console.error(`❌ 提取失败: ${error.message}`);
  console.error(`\n📝 建议：`);
  console.error(`   1. 手动从 GitHub 下载 TTF 文件：`);
  console.error(`      https://github.com/notofonts/noto-cjk/releases`);
  console.error(`   2. 下载 "Subset TTF" 格式的 NotoSansCJK-SC-Regular.ttf`);
  console.error(`   3. 放到: ${OUTPUT_DIR}/`);
  process.exit(1);
}
