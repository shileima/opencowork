/**
 * 更新图标颜色为美团风格
 * 背景：黄色（美团标准黄色）
 * 图形：保持原色（白色）
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const sourceIconPath = join(projectRoot, 'public', 'icon.png');
const outputIconPath = join(projectRoot, 'public', 'icon.png'); // 覆盖原文件

// 美团标准黄色（北京黄色）
// 根据美团品牌色，使用更准确的黄色值
// RGB: 255, 192, 0 或 RGB: 255, 179, 0 (更接近实际)
const MEITUAN_YELLOW = { r: 255, g: 192, b: 0 }; // #FFC000
const BLACK = { r: 0, g: 0, b: 0 }; // 黑色图形

console.log('🎨 开始更新图标颜色为美团风格...');
console.log(`   源文件: ${sourceIconPath}`);
console.log(`   背景色: RGB(${MEITUAN_YELLOW.r}, ${MEITUAN_YELLOW.g}, ${MEITUAN_YELLOW.b}) / #FFC000`);
console.log(`   图形色: 保持原色（白色）`);

try {
  // 读取原始图标
  const image = sharp(sourceIconPath);
  const metadata = await image.metadata();
  
  console.log(`\n📐 图标尺寸: ${metadata.width}x${metadata.height}`);
  
  // 创建新的图像：黄色背景 + 保持原图形颜色
  // 策略：
  // 1. 识别橙色背景区域
  // 2. 将橙色背景替换为美团黄色
  // 3. 保持所有白色图形元素不变
  
  // 读取原始图标像素
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  const pixels = new Uint8Array(data);
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  
  // 创建新图像数据：黄色背景 + 黑色图形
  const newPixels = new Uint8Array(width * height * channels);
  
  // 计算边角区域大小（用于检测并去除白色，但保留圆角形态）
  const cornerSize = Math.min(width, height) * 0.15; // 边缘15%的区域
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const alpha = pixels[idx + 3] || 255;
      
      // 计算到边缘的距离
      const distToTop = y;
      const distToBottom = height - y;
      const distToLeft = x;
      const distToRight = width - x;
      const minDistToEdge = Math.min(distToTop, distToBottom, distToLeft, distToRight);
      
      // 判断是否在边角区域
      const isInCorner = minDistToEdge < cornerSize;
      
      // 判断像素类型
      const isTransparent = alpha < 10;
      
      // 判断是否为白色或浅色背景（RGB 值都大于 200，或者接近白色）
      const isLightBackground = alpha > 10 && r > 200 && g > 200 && b > 200;
      
      // 判断是否为黄色（可能是之前处理过的）
      const isYellow = alpha > 10 && 
        Math.abs(r - MEITUAN_YELLOW.r) < 50 &&
        Math.abs(g - MEITUAN_YELLOW.g) < 50 &&
        Math.abs(b - MEITUAN_YELLOW.b) < 50;
      
      // 判断是否为图形部分（橙色、红色等）
      // 图形通常是橙色(R>180, G<150, B<100)、红色等
      const isOrangeOrRed = alpha > 10 && r > 180 && g < 150 && b < 100;
      const isDark = alpha > 10 && r < 100 && g < 100 && b < 100;
      const isGraphic = isOrangeOrRed || isDark;
      
      // 判断是否为白色图形元素（需要保持纯白色）
      // 白色图形：RGB 值都大于 200，且不是橙色背景
      const isWhiteGraphic = alpha > 10 && r > 200 && g > 200 && b > 200;
      
      // 判断是否为橙色背景（需要替换为黄色）
      const isOrangeBackground = alpha > 10 && 
        r > 180 && r < 255 && 
        g > 50 && g < 150 && 
        b < 100;
      
      // 判断是否为浅橙色/过渡色（也需要替换为黄色）
      const isLightOrange = alpha > 10 && 
        r > 150 && 
        g > 100 && g < 200 && 
        b < 150 &&
        !isWhiteGraphic;
      
      // 判断边角区域的白色是否是图形的一部分（连接线、节点等）
      // 如果边角区域的白色像素周围有其他白色像素（可能是图形的一部分），保持白色
      // 否则，边角的白色应该是背景的一部分，改为黄色
      let isCornerWhitePartOfGraphic = false;
      if (isInCorner && isWhiteGraphic) {
        // 检查周围8个像素，看是否有其他白色像素（可能是图形的一部分）
        let nearbyWhiteCount = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = (ny * width + nx) * channels;
              const nr = pixels[nIdx];
              const ng = pixels[nIdx + 1];
              const nb = pixels[nIdx + 2];
              const na = pixels[nIdx + 3] || 255;
              if (na > 10 && nr > 200 && ng > 200 && nb > 200) {
                nearbyWhiteCount++;
              }
            }
          }
        }
        // 如果周围有足够的白色像素，说明这是图形的一部分
        isCornerWhitePartOfGraphic = nearbyWhiteCount > 3;
      }
      
      // 边角区域：非图形白色改为黄色（去除白色圆角）
      if (isInCorner && isWhiteGraphic && !isCornerWhitePartOfGraphic) {
        // 边角区域的白色背景：改为黄色 ✅
        newPixels[idx] = MEITUAN_YELLOW.r;
        newPixels[idx + 1] = MEITUAN_YELLOW.g;
        newPixels[idx + 2] = MEITUAN_YELLOW.b;
        newPixels[idx + 3] = 255; // 不透明
      } else if (isInCorner && !isWhiteGraphic) {
        // 边角区域非白色：设为黄色背景 ✅
        newPixels[idx] = MEITUAN_YELLOW.r;
        newPixels[idx + 1] = MEITUAN_YELLOW.g;
        newPixels[idx + 2] = MEITUAN_YELLOW.b;
        newPixels[idx + 3] = 255; // 不透明
      } else if (isWhiteGraphic) {
        // 白色图形元素：强制设为纯白色，去除灰色阴影 ✅
        newPixels[idx] = 255; // 纯白色 R
        newPixels[idx + 1] = 255; // 纯白色 G
        newPixels[idx + 2] = 255; // 纯白色 B
        newPixels[idx + 3] = 255; // 完全不透明
      } else if (isOrangeBackground || isLightOrange || isOrangeOrRed) {
        // 橙色背景：替换为美团黄色 ✅
        newPixels[idx] = MEITUAN_YELLOW.r;
        newPixels[idx + 1] = MEITUAN_YELLOW.g;
        newPixels[idx + 2] = MEITUAN_YELLOW.b;
        newPixels[idx + 3] = 255; // 不透明
      } else if (isTransparent) {
        // 透明：设为黄色背景
        newPixels[idx] = MEITUAN_YELLOW.r;
        newPixels[idx + 1] = MEITUAN_YELLOW.g;
        newPixels[idx + 2] = MEITUAN_YELLOW.b;
        newPixels[idx + 3] = 0; // 保持透明
      } else if (isYellow) {
        // 已经是黄色：保持不变
        newPixels[idx] = MEITUAN_YELLOW.r;
        newPixels[idx + 1] = MEITUAN_YELLOW.g;
        newPixels[idx + 2] = MEITUAN_YELLOW.b;
        newPixels[idx + 3] = 255;
      } else {
        // 其他颜色（可能是过渡色、阴影等）：设为黄色背景
        newPixels[idx] = MEITUAN_YELLOW.r;
        newPixels[idx + 1] = MEITUAN_YELLOW.g;
        newPixels[idx + 2] = MEITUAN_YELLOW.b;
        newPixels[idx + 3] = 255;
      }
    }
  }
  
  // 创建新图像
  await sharp(newPixels, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .png()
    .toFile(outputIconPath);
  
  console.log('\n✅ 图标颜色更新完成！');
  console.log(`   输出文件: ${outputIconPath}`);
  console.log('\n📝 下一步：运行 "npm run build:icons" 重新生成所有格式的图标');
  
} catch (error) {
  console.error('\n❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
}
