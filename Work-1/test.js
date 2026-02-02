let seed = 42;
let tubes = [];
let bricks = [];

// Colors
const PRIMARY_GOLD = [201, 162, 39];
const BRONZE = [139, 105, 20];
const HIGHLIGHT = [232, 213, 144];
const SHADOW = [60, 45, 15];
const BG_COLOR = [15, 12, 10];

// for circle
let circleX, circleY, circleRadius;

function setup() {
    createCanvas(windowWidth, windowHeight);
    pixelDensity(2);
    noLoop();
    generateArt();
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    generateArt();
}

function mousePressed() {
    seed = floor(random(999999));
    generateArt();
}

function keyPressed() {
    if (key === ' ' || key === 'r' || key === 'R') {
        seed = floor(random(999999));
        generateArt();
    }
    if (key === 's' || key === 'S') {
        saveCanvas('industrial-tessellation-' + seed, 'png');
    }
}

function generateArt() {
    randomSeed(seed);
    noiseSeed(seed);

    tubes = [];
    bricks = [];

    // define the circle
    circleX = width * 0.2;
    circleY = height * 0.35;
    circleRadius = min(width, height) * 0.22;

    generateBricksAndTubes();

    redraw();
}

function generateBricksAndTubes() {
    let brickW = width / 55; // canvas divided into 55 vertical columns

    // 确定每列的类型（1-2列正方形，1-2列长方形交替）
    let columnTypes = [];
    let col = 0;
    while (col < 55) {
        let squareCols = floor(random(1, 3));
        for (let i = 0; i < squareCols && col < 55; i++) {
            columnTypes[col] = 'square9';
            col++;
        }
        let rectCols = floor(random(1, 3));
        for (let i = 0; i < rectCols && col < 55; i++) {
            columnTypes[col] = 'horizontal';
            col++;
        }
    }

    // 确定每列砖块延伸的高度
    // 正方形列：左边到底，中间到右边变短
    // 长方形列：永远不到底，留空间给蜂窝
    let columnHeights = [];
    for (let col = 0; col < 55; col++) {
        let xProgress = col / 55;
        let noiseVal = noise(col * 0.2, seed * 0.01);

        // base column height（从左到右逐渐变短）
        let baseColumnHeight;
        if (xProgress < 0.35) {
            baseColumnHeight = height + 50; // 左边到底
        } else {
            // 中间到右边：逐渐变短
            let rightProgress = (xProgress - 0.35) / 0.65;
            baseColumnHeight = height * (1.0 - rightProgress * 0.45) * (0.7 + noiseVal * 0.3);
        }

        if (columnTypes[col] === 'square9') {
            // 正方形列：使用基准高度
            columnHeights[col] = baseColumnHeight;
        } else {
            // 长方形列：比正方形列短30%，留空间给蜂窝
            columnHeights[col] = baseColumnHeight * 0.65; //sqaure colum is higher then rectangle
        }
    }

    // 第三步：生成砖块列
    for (let col = 0; col < 55; col++) {
        let x = col * brickW + brickW / 2;
        let colType = columnTypes[col];
        let maxY = columnHeights[col];

        let y = 0;
        while (y < maxY) {
            if (colType === 'square9') {
                bricks.push({
                    x: x,
                    y: y,
                    w: brickW,
                    h: brickW,
                    depth: noise(x * 0.01, y * 0.01) * 0.4,
                    type: 'square9'
                });
                y += brickW;
            } else {
                let rectH = brickW * 0.28;
                bricks.push({
                    x: x,
                    y: y,
                    w: brickW,
                    h: rectH,
                    depth: noise(x * 0.01, y * 0.01) * 0.4,
                    type: 'horizontal'
                });
                y += rectH;
            }
        }
    }

    // 第四步：用蜂窝管道填充，大小不一，小圆填补空隙
    let baseRadius = min(width, height) * 0.022;

    // 检查点是否在可填充区域
    function canPlaceTube(x, y) {
        let colIndex = floor(x / brickW);
        if (colIndex < 0 || colIndex >= 55) return false; //tubes always under the bricks
        if (y < columnHeights[colIndex]) return false;
        let colXProgress = colIndex / 55;
        if (colXProgress < 0.35 && columnTypes[colIndex] !== 'horizontal') return false; //tubes not under the bricks
        return true;
    }

    // 检查是否与已有圆重叠
    function overlapsExisting(x, y, r) {
        for (let t of tubes) {
            let dx = x - t.x;
            let dy = y - t.y;
            let dist = sqrt(dx * dx + dy * dy);
            if (dist < r + t.radius - 1) return true;
        }
        return false;
    }

    // 第一遍：大圆蜂窝排列
    let tubeRow = 0;
    for (let y = 0; y < height + baseRadius * 2; y += baseRadius * 1.8) {
        let offsetX = (tubeRow % 2) * baseRadius;
        for (let x = offsetX; x < width + baseRadius * 2; x += baseRadius * 2) {
            if (!canPlaceTube(x, y)) continue;

            let sizeVar = random(0.7, 1.3);
            let radius = baseRadius * sizeVar;

            tubes.push({
                x: x + random(-2, 2),
                y: y + random(-2, 2),
                radius: radius,
                depth: random(0.4),
                brightness: random(0.5, 1.0)
            });
        }
        tubeRow++;
    }

    // 第二遍：中等圆填补空隙
    let mediumRadius = baseRadius * 0.6;
    for (let y = 0; y < height + mediumRadius * 2; y += mediumRadius * 1.5) {
        let offsetX = (floor(y / mediumRadius) % 2) * mediumRadius * 0.75;
        for (let x = offsetX; x < width + mediumRadius * 2; x += mediumRadius * 1.5) {
            if (!canPlaceTube(x, y)) continue;

            let radius = mediumRadius * random(0.8, 1.1);
            if (overlapsExisting(x, y, radius)) continue;

            tubes.push({
                x: x,
                y: y,
                radius: radius,
                depth: random(0.4),
                brightness: random(0.5, 1.0)
            });
        }
    }

    // 第三遍：较小圆填补剩余空隙（
    let smallRadius = baseRadius * 0.4; //I try to make it not too small here.
    for (let y = 0; y < height + smallRadius * 2; y += smallRadius * 1.3) {
        let offsetX = (floor(y / smallRadius) % 2) * smallRadius * 0.65;
        for (let x = offsetX; x < width + smallRadius * 2; x += smallRadius * 1.3) {
            if (!canPlaceTube(x, y)) continue;

            let radius = smallRadius * random(0.85, 1.1);
            if (overlapsExisting(x, y, radius)) continue;

            tubes.push({
                x: x,
                y: y,
                radius: radius,
                depth: random(0.4),
                brightness: random(0.5, 0.95)
            });
        }
    }
}

function getMetallicColor(depth, brightness) {
    let r, g, b;

    if (brightness > 0.85) {
        let t = (brightness - 0.85) * 6.67;
        r = lerp(PRIMARY_GOLD[0], HIGHLIGHT[0], t);
        g = lerp(PRIMARY_GOLD[1], HIGHLIGHT[1], t);
        b = lerp(PRIMARY_GOLD[2], HIGHLIGHT[2], t);
    } else if (brightness > 0.4) {
        let t = (brightness - 0.4) / 0.45;
        r = lerp(BRONZE[0], PRIMARY_GOLD[0], t);
        g = lerp(BRONZE[1], PRIMARY_GOLD[1], t);
        b = lerp(BRONZE[2], PRIMARY_GOLD[2], t);
    } else {
        let t = brightness / 0.4;
        r = lerp(SHADOW[0], BRONZE[0], t);
        g = lerp(SHADOW[1], BRONZE[1], t);
        b = lerp(SHADOW[2], BRONZE[2], t);
    }

    let depthFactor = 1 - depth * 0.4;
    return color(r * depthFactor, g * depthFactor, b * depthFactor);
}

function draw() {
    background(BG_COLOR[0], BG_COLOR[1], BG_COLOR[2]);

    // 先画管道
    for (let t of tubes) {
        drawTube(t);
    }

    // 再画砖块（前景层）
    for (let b of bricks) {

        drawBrick(b);
    }

    // 最后画圆形焦点
    drawCircleFocal();
}

function drawBrick(b) {
    let baseColor = getMetallicColor(b.depth, 0.7);

    push();
    translate(b.x, b.y);

    if (b.type === 'square9') {
        fill(baseColor);
        noStroke();
        rect(-b.w/2, 0, b.w, b.h);

        // 3x3 = 9个孔
        fill(BG_COLOR[0] + 6, BG_COLOR[1] + 5, BG_COLOR[2] + 3);
        let margin = b.w * 0.1;
        let holeSize = (b.w - margin * 2) / 3 * 0.78;
        let spacing = (b.w - margin * 2) / 3;

        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                let hx = -b.w/2 + margin + i * spacing + (spacing - holeSize) / 2;
                let hy = margin + j * spacing + (spacing - holeSize) / 2;
                rect(hx, hy, holeSize, holeSize);
            }
        }

        // 顶部高光
        let hlColor = getMetallicColor(b.depth * 0.5, 0.85);
        fill(hlColor);
        rect(-b.w/2 + b.w * 0.05, b.h * 0.02, b.w * 0.9, b.h * 0.06);

    } else if (b.type === 'horizontal') {
        fill(baseColor);
        noStroke();
        rect(-b.w/2, 0, b.w, b.h);

        // 顶部高光
        let hlColor = getMetallicColor(b.depth * 0.4, 0.88);
        fill(hlColor);
        rect(-b.w/2 + b.w * 0.04, b.h * 0.08, b.w * 0.92, b.h * 0.18);
    }

    pop();
}

function drawTube(t) {
    push();
    translate(t.x, t.y);

    let outerColor = getMetallicColor(t.depth, t.brightness * 0.9);
    noStroke();
    fill(outerColor);
    ellipse(0, 0, t.radius * 2, t.radius * 2);

    let wallThickness = t.radius * 0.18;
    let innerR = t.radius - wallThickness;
    let shadowColor = getMetallicColor(t.depth + 0.25, t.brightness * 0.45);
    fill(shadowColor);
    ellipse(0, -0.5, innerR * 2, innerR * 2);

    fill(BG_COLOR[0] + 5, BG_COLOR[1] + 4, BG_COLOR[2] + 2);
    ellipse(0, -1, innerR * 1.4, innerR * 1.4);

    if (t.brightness > 0.6) {
        let hlColor = getMetallicColor(t.depth * 0.3, 0.95);
        noFill();
        stroke(red(hlColor), green(hlColor), blue(hlColor), 100);
        strokeWeight(0.8);
        arc(0, 0, t.radius * 1.7, t.radius * 1.7, PI + 0.5, TWO_PI - 0.3);
    }

    pop();
}

function drawCircleFocal() {
    push();
    translate(circleX, circleY);

    // 用圆形裁剪
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.arc(0, 0, circleRadius, 0, Math.PI * 2);
    drawingContext.clip();

    // 斜向角度
    let angle = PI / 6; // 30度斜角
    rotate(angle);

    // 斜向堆叠的列宽
    let colW = circleRadius * 0.2;
    let startX = -circleRadius * 1.5;
    let endX = circleRadius * 1.5;

    let colIndex = 0;
    for (let x = startX; x < endX; x += colW) {
        let isSquareCol = (colIndex % 2 === 0);

        if (isSquareCol) {
            // 正方形列（无孔）
            let squareSize = colW * 0.98;
            for (let y = -circleRadius * 1.5; y < circleRadius * 1.5; y += squareSize) {
                let brightness = 0.6 + noise(x * 0.05, y * 0.05) * 0.35;
                let baseColor = getMetallicColor(0.15, brightness);

                fill(baseColor);
                noStroke();
                rect(x, y, squareSize, squareSize);
            }
        } else {
            // 长方形列（无孔）
            let rectH = colW * 0.28;
            for (let y = -circleRadius * 1.5; y < circleRadius * 1.5; y += rectH) {
                let brightness = 0.6 + noise(x * 0.05, y * 0.05) * 0.3;
                let baseColor = getMetallicColor(0.12, brightness);

                fill(baseColor);
                noStroke();
                rect(x, y, colW * 0.98, rectH * 0.95);
            }
        }
        colIndex++;
    }

    drawingContext.restore();
    pop();
}
