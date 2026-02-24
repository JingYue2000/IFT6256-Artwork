// --- Graphics & shader ---
let theShader;
let webGLCanvas        // offscreen WebGL canvas for shader post-processing
let originalGraphics   // offscreen 2D canvas: all scene elements drawn here
                       // overlayGraphics:(blended via MULTIPLY)

// --- Color palette (randomized per run) ---
let factors = []       // [6 values] base RGB components for sky, ocean, and UI colors
let yFactors = []      // [5 values] amplitude controls for each recursion depth level

// --- layout ---
let startHeight        // y- where ocean surface begins (sky above, waves below)
let mountainSpan       // vertical spacing between wave layers (px); smaller = more waves
let reduceMountainCount = 0  // (leaves room for beach)

// --- Sun ---
let targetSunRaiseFactor = 0, sunRaiseFactor = -1  // sun vertical position (0=top, 100=bottom)
let sunXPos = 0        // sun horizontal position
let birdCount = 0      // number of animated birds in the sky

// Wave direction & shape ---
let waveAngle = 0.25
                       // noise coordinates are projected onto this angle so crests align along it

// Spine params: controls where wave crests appear horizontally ---
let prevLayerPoints = null  // previous layer's points, used for layer inheritance
let spineBaseX = 0          // left anchor of the spine curve (near x=0)
let spineAmplitude = 0      // how far the spine bulges rightward at the vertical midpoint
let spineNoiseSeed = 0      // unique noise offset so each run has a different spine wobble
let waveWidth = 200          // right-side sigma of the bell envelope (controls how gradually each wave fades)


// compile the GLSL shader (defined in hw2_bezier.html)
function preload(){
    theShader = new p5.Shader(this.renderer, vert, frag)
}


// SETUP: randomize all scene parameters
function setup() {
    pixelDensity(1)
    createCanvas(1080, 1920);
    webGLCanvas = createGraphics(width, height, WEBGL)
    originalGraphics = createGraphics(width, height)
    overlayGraphics = createGraphics(width, height)
    noStroke()

    // Ocean starts between 25%–45% from top, leaving at least 1/4 sky
    startHeight = height * random(0.25, 0.45)
    targetSunRaiseFactor = 0.5
    mouseY = random(height * 0.1, startHeight + 0.2 * height)  // initial sun height
    background(0);

    mountainSpan = int(random([2, 3])) * 10 // 20px → 每层浪之间的垂直间距
    birdCount = random([0, 10])               // birds

    // Randomized color palette — each value is an RGB component seed
    factors  = [random(10,50), random(20,60), random(40,120), random(30,70), random(80,180), random(40,100)]
    // Amplitude per recursion depth: [depth0, depth1, depth2, depth3, depth4]
    yFactors = [random(40,80), random(80,180), random(30,60), random(25,50), random([0,10])]

    reduceMountainCount = int(random(2, 4))         // cut 2–4 layers from bottom
    sunXPos = random(0.2, 0.8) * width              // sun somewhere in middle 60%
    mouseX = random(width * 0.3, width * 0.9)       // initial horizontal pan

    waveAngle = random(0.15, 0.4)                   // wave propagation direction

    // Spine: C-shaped curve anchored near left edge, bulging right in the middle
    spineBaseX     = random(0, width * 0.1)          // start near left edge
    spineAmplitude = random(width * 0.3, width * 0.6) // max rightward bulge
    spineNoiseSeed = random(1000)                    // unique wobble per run
    waveWidth      = random(150, 250)                // bell envelope right-side width
}

//BELL cover
// Returns a value 0–1 that shapes the wave displacement. --later
// Sharp rise on the left of spineX (sigma=25px), gradual decay on the right
function asymBell(x, spineX) {
    let dx = x - spineX
    let sigmaLeft  = 25         // sharp rise approaching crest from the left
    let sigmaRight = waveWidth  // gradual falloff past the crest
    let sigma = dx < 0 ? sigmaLeft : sigmaRight //left small sigma is 窄
    return exp(-(dx * dx) / (2 * sigma * sigma))  //exp(-abs(dx))

}

// my RECURSIVE MIDPOINT alg

function subdivideWave(x1, y1, x2, y2, baseY, depth, maxDepth, points) {
    let mx = (x1 + x2) / 2  // midpoint x

    // Project position onto wave propagation direction for noise lookup
    let dirPhase = mx * cos(waveAngle) + baseY * sin(waveAngle) //not looks like a copy

    // Amplitude decreases exponentially  振幅
    let ampScale = pow(0.55, depth)
    let amps = [yFactors[1], yFactors[0], yFactors[2], yFactors[3], yFactors[4] * 3]
    let amp = amps[min(depth, amps.length - 1)] * ampScale

    // disp
    let disp
    if (depth <= 1) {
        // always push upward to form crests
        // -0.5*amp to -1.0*amp (always negative/upward)
        let nv = noise(dirPhase / (300 * ampScale + 80), baseY / (400 + depth * 100))
        disp = -amp * (0.5 + nv * 0.5)
    } else {
        //
        // (noise-0.5)*2 ranges from -1 to +1
        let noiseScale = 300 * ampScale + 80
        let nv = (noise(dirPhase / noiseScale, baseY / (400 + depth * 100)) - 0.5) * 2
        disp = nv * amp
    }

    // Midpoint y = average of parent endpoints + displacement
    let my = (y1 + y2) / 2 + disp

    // at max depth, just record the point
    if (depth >= maxDepth) {
        points.push(createVector(mx, my))
        return
    }

    //  left half → record midpoint → right half (in-order traversal)
    subdivideWave(x1, y1, mx, my, baseY, depth + 1, maxDepth, points)
    points.push(createVector(mx, my))
    subdivideWave(mx, my, x2, y2, baseY, depth + 1, maxDepth, points)
}


function draw() {
    // entire canvas with ocean base color
    originalGraphics.fill(factors[0] * 0.5, factors[2] / 2, factors[4] / 2)
    originalGraphics.rect(0, 0, width, height)
    overlayGraphics.clear()

    // sun position toward target reference: https://openprocessing.org/sketch/1611511
    targetSunRaiseFactor = map(mouseY, 0, height, 0, 100, true)
    if (sunRaiseFactor == -1) sunRaiseFactor = targetSunRaiseFactor
    sunRaiseFactor = lerp(sunRaiseFactor, targetSunRaiseFactor, 0.1)

    // Sky gradient: horizontal lines from bottom to top, color shifts with height ---
    for (var y = height; y -= 10; y >= 0) {
        let dk = sunRaiseFactor / 1.5 + 5
        let hy = (y - startHeight)
        let skyDarkFactor = 0.8
        originalGraphics.stroke(
            factors[0] * skyDarkFactor + hy / 50 - dk,
            factors[2] * skyDarkFactor + hy / 40 - dk,
            factors[4] * skyDarkFactor + hy / 50 - dk)
        originalGraphics.strokeWeight(10)
        originalGraphics.line(0, y, width, y)
    }

    // for Sun:  semi-transparent circles create a glow effect
    for (var i = 0; i < 25; i++) {
        originalGraphics.strokeWeight(3)
        originalGraphics.noFill()
        originalGraphics.stroke(255, 40)
        originalGraphics.circle(sunXPos, sunRaiseFactor / 100 * height, pow(i, 1.5))
    }

    // other Clouds: faint horizontal lines at noise-driven heights
    for (var i = 0; i < 40; i++) {
        originalGraphics.push()
        originalGraphics.translate(0, noise(0, i / 20) * height / 2)
        originalGraphics.strokeWeight(1)
        originalGraphics.noStroke()
        originalGraphics.stroke(255, 20)
        originalGraphics.line(0, 0, width, 0)
        originalGraphics.pop()
    }

    // -ocean base: solid rectangle that hides the sun below the waterline
    originalGraphics.noStroke()
    originalGraphics.fill(factors[0] * 0.5, factors[2] / 2, factors[4] / 2)
    originalGraphics.rect(0, startHeight, width, height - startHeight)

    // =========================================================================
    // WAVE LAYERS
    // Each layer is a horizontal band. From startHeight downward, spaced by mountainSpan.
    prevLayerPoints = null
    for (let y = startHeight; y < height - mountainSpan * reduceMountainCount; y += mountainSpan) {
        originalGraphics.push()

        // like 3d..: deeper layers shift more with mouse position refer: https://openprocessing.org/sketch/1611511
        let xPan = map(mouseX, 0, width, -1, 1) * sqrt(y - startHeight + 100)
        originalGraphics.translate(xPan, 0)

        let points = []

        // dot position for this layer  !
        // C-shaped parabola: 0 at top/bottom, max bulge at vertical center
        // Plus noise wobble for irregularity
        let endY = height - mountainSpan * reduceMountainCount
        let t = map(y, startHeight, endY, -1, 1)          // -1 at top, +1 at bottom
        let cShape = (1 - t * t) * spineAmplitude          // parabola: peaks at t=0 (middle)
        let wobble = (noise(spineNoiseSeed, y / 200) - 0.5) * 2 * spineAmplitude * 0.3
        let spineX = spineBaseX + cShape + wobble

        // Endpoint y-values with slight noise offset
        let y1 = y - yFactors[1] * 0.5 * noise(-50 * cos(waveAngle) / 300, y / 600)
        let y2 = y - yFactors[1] * 0.5 * noise((width + 50) * cos(waveAngle) / 300, y / 600)

        // --- Layer inheritance: this layer's baseline is nudged by the previous layer's shape ---
        // Prevents layers from being completely independent
        let effectiveY = y
        if (prevLayerPoints !== null) {
            let inheritStrength = 0.15
            let prevAvg = 0
            for (let pp of prevLayerPoints) {
                prevAvg += (pp.y - (y - mountainSpan))
            }
            prevAvg /= prevLayerPoints.length
            effectiveY = y + prevAvg * inheritStrength
        } //keep continues

        // Generate wave with recursive midpoint displacement
        points.push(createVector(-50, y1))                           // left edge
        subdivideWave(-50, y1, width + 50, y2, effectiveY, 0, 6, points)  // 6 → 64 segments
        points.push(createVector(width + 50, y2))                    // right edge

        // multiply displacement by asymmetric bell envelope ---
        // Without this, waves span the full width.
        for (let p of points) {
            let b = asymBell(p.x, spineX) //around spineX, creating localized crests that fade to flat on the sides.
            p.y = y + (p.y - y) * b  // scale displacement from baseline by bell value
        }

        prevLayerPoints = points  // save for next layer's inheritance

        // 5 color gradient strips from dark to crest (bright)
        // Each strip is a closed shape between two horizontal slices of the wave
        let bodyDepth = mountainSpan * 0.8
        let depthFactor = map(y, startHeight, height * 0.7, 1.0, 0.5)  // fade deeper layers

        // Three stop color gradient: deep indigo → teal midtone → bright cyan at crest
        let deepR  = factors[0] * 0.3 * depthFactor,       deepG  = factors[2] * 0.3 * depthFactor,       deepB  = factors[4] * 0.6 * depthFactor + 40
        let midR   = factors[0] * 0.2 * depthFactor + 20,  midG   = factors[2] * 0.5 * depthFactor + 60,  midB   = factors[4] * 0.4 * depthFactor + 80
        let crestR = 80 * depthFactor + 60,                 crestG = 160 * depthFactor + 40,               crestB = 180 * depthFactor + 50

        let strips = 5
        for (let s = 0; s < strips; s++) {
            let t0 = s / strips         // bottom of strip (0 = wave bottom)
            let t1 = (s + 1) / strips   // top of strip (1 = wave crest)

            // Interpolate color: deep→mid at t<0.5, mid→crest at t>0.5
            let r0 = t0 < 0.5 ? lerp(deepR, midR, t0 * 2)  : lerp(midR, crestR, (t0 - 0.5) * 2)
            let g0 = t0 < 0.5 ? lerp(deepG, midG, t0 * 2)  : lerp(midG, crestG, (t0 - 0.5) * 2)
            let b0 = t0 < 0.5 ? lerp(deepB, midB, t0 * 2)  : lerp(midB, crestB, (t0 - 0.5) * 2)
            let alphaStrip = lerp(90, 50, t0)  // bottom strips more dark

            originalGraphics.noStroke()
            originalGraphics.fill(r0, g0, b0, alphaStrip)
            originalGraphics.beginShape()
            // Bottom edge of strip (closer to sea floor)
            for (let p of points) {
                let bell = asymBell(p.x, spineX)
                let rise = y - p.y
                let stripBottom = p.y + rise * t0 + bodyDepth * bell * (1 - t0)
                originalGraphics.vertex(p.x, stripBottom)
            }
            // Top edge of strip (closer to wave crest), reversed for closed shape
            for (let i = points.length - 1; i >= 0; i--) {
                let p = points[i]
                let bell = asymBell(p.x, spineX)
                let rise = y - p.y
                let stripTop = p.y + rise * t1 + bodyDepth * bell * (1 - t1)
                originalGraphics.vertex(p.x, stripTop)
            }
            originalGraphics.endShape(CLOSE)
        }

        // --- Crest ridge line: bezier curves along the wave top edge ---
        // Color shifts from teal (flat areas) to bright white (at crests)
        originalGraphics.noFill()
        for (let i = 0; i < points.length - 3; i++) {
            let p0 = points[i], p1 = points[i+1], p2 = points[i+2], p3 = points[i+3]
            let rise = ((y - p1.y) + (y - p2.y)) / 2              // avg rise above baseline
            let bright = map(rise, 5, 150, 0, 1, true)            // 0=flat, 1=tall crest
            let lr = lerp(60 * depthFactor, 250, bright)
            let lg = lerp(130 * depthFactor, 252, bright)
            let lb = lerp(170 * depthFactor, 255, bright)
            originalGraphics.stroke(lr, lg, lb, 80 + bright * 175) // base alpha 80, up to 255
            originalGraphics.strokeWeight(0.8 + bright * 2.5)
            originalGraphics.bezier(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y) // line()
        }

        // 浪花 Foam at crests: three tiers based on crest proximity ---
        for (let i = 1; i < points.length; i++) {
            let p = points[i]
            let rise = y - p.y  // how far above baseline (higher = bigger crest)
            let crestProximity = map(rise, 10, 120, 0, 1, true)  // normalized 0–1

            // Tier 1: Teal/cyan undertone — appears at all crests (>0.05)
            // Gives the water a translucent color before turning white
            if (crestProximity > 0.05) {
                let tealAlpha = crestProximity * 120
                let nn = noise(p.x / 30, y / 30)
                let fr = lerp(40 + nn * 30, 220, crestProximity)
                let fg = lerp(120 + nn * 40, 240, crestProximity)
                let fb = lerp(160 + nn * 30, 250, crestProximity)
                let rr = 3 + crestProximity * 14 + nn * 8
                originalGraphics.noStroke()
                originalGraphics.fill(fr, fg, fb, tealAlpha)
                originalGraphics.ellipse(
                    p.x + noise(p.x, p.y) * 10 - 5,
                    p.y + noise(p.y, p.x) * 6 - 3,
                    rr, rr * 0.6)
            }

            //  White foam highlights — only at strong crests (>0.35)
            if (crestProximity > 0.35) {
                let foamAlpha = map(crestProximity, 0.35, 1, 40, 220)
                let rr = 1 + crestProximity * 8 + noise(p.x * 5, y * 5) * 4
                originalGraphics.noStroke()
                originalGraphics.fill(240, 248, 255, foamAlpha)
                originalGraphics.ellipse(
                    p.x + noise(p.x * 2, p.y) * 8 - 4,
                    p.y + noise(p.y * 2, p.x) * 4 - 2,
                    rr, rr * 0.5)
            }

            // Tier 3: Spray particles — only at the tallest crests (>0.5)
            // Drawn on overlayGraphics (composited via MULTIPLY blend mode)
            if (crestProximity > 0.5 && i % 3 === 0) {
                for (let s = 0; s < int(crestProximity * 4); s++) {
                    overlayGraphics.noStroke()
                    overlayGraphics.fill(255, random(150, 255))
                    overlayGraphics.ellipse(
                        p.x + random(-15, 15),
                        p.y - random(3, 25 + crestProximity * 30),
                        random(2, 6 + crestProximity * 4))
                }
            }
        }

        originalGraphics.pop()
    }

    // =========================================================================
    // BEACH:
    {
        let g = originalGraphics

        // Shoreline arc: from right edge (55% down) to bottom edge (55% from left)
        let shoreStartY = height * 0.55
        let shoreEndX   = width * 0.55
        let shoreSeed   = spineNoiseSeed + 500  // add noise from wave spine

        // Ocean color (to blend from)
        let oceanR = factors[0] * 0.5, oceanG = factors[2] / 2, oceanB = factors[4] / 2

        // curve: quadratic arc + sin bulge + noise wobble
        let shorePoints = []
        let steps = 40
        for (let i = 0; i <= steps; i++) {
            let t = i / steps
            let baseX = lerp(width, shoreEndX, t)
            let baseY = lerp(shoreStartY, height, t)
            let bulge = sin(t * PI) * 120  // concave bulge toward bottom-right
            baseX += bulge
            baseY -= bulge * 0.3
            baseX += (noise(shoreSeed, t * 5) - 0.5) * 60       // x wobble
            baseY += (noise(shoreSeed + 100, t * 5) - 0.5) * 30 // y wobble
            shorePoints.push(createVector(baseX, baseY))
        }

        // Sand color: muted warm brown (not too bright)
        let sandR = 120 + noise(shoreSeed) * 25
        let sandG = 105 + noise(shoreSeed + 1) * 20
        let sandB = 70  + noise(shoreSeed + 2) * 15

        // 8 gradient bands: ocean color → shallow water → wet sand → dry sand
        // Each band is offset toward bottom-right from the shoreline
        let bandCount = 8
        for (let band = 0; band < bandCount; band++) {
            let bT = band / bandCount  // 0 = ocean edge, 1 = deep sand
            let offset = band * 18     // px offset from shoreline

            // Three-phase color interpolation
            let r, gr, b, alpha
            if (bT < 0.3) {
                // Phase 1: Ocean → shallow water (teal tint)
                let lt = bT / 0.3
                r     = lerp(oceanR, oceanR * 0.6 + 30, lt)
                gr    = lerp(oceanG, oceanG * 0.7 + 40, lt)
                b     = lerp(oceanB, oceanB * 0.5 + 50, lt)
                alpha = lerp(60, 90, lt)
            } else if (bT < 0.6) {
                // Phase 2: Shallow water → wet sand
                let lt = (bT - 0.3) / 0.3
                r     = lerp(oceanR * 0.6 + 30, sandR * 0.55, lt)
                gr    = lerp(oceanG * 0.7 + 40, sandG * 0.55, lt)
                b     = lerp(oceanB * 0.5 + 50, sandB * 0.6, lt)
                alpha = lerp(90, 160, lt)
            } else {
                // Phase 3: Wet sand → dry sand
                let lt = (bT - 0.6) / 0.4
                r     = lerp(sandR * 0.55, sandR, lt)
                gr    = lerp(sandG * 0.55, sandG, lt)
                b     = lerp(sandB * 0.6, sandB, lt)
                alpha = lerp(160, 220, lt)
            }

            g.noStroke()
            g.fill(r, gr, b, alpha)
            g.beginShape()
            for (let p of shorePoints) {
                g.vertex(p.x + 0.7 * offset, p.y + 0.7 * offset)  // shift toward bottom-right
            }
            g.vertex(width, height)              // bottom-right corner
            g.vertex(width, shoreStartY - 20)    // close along right edge
            g.endShape(CLOSE)
        }

        // --- Sand grain texture: scattered dark/light speckles ---
        for (let i = 0; i < 150; i++) {
            let t = random()
            let baseX = lerp(width, shoreEndX, t) + sin(t * PI) * 120
            let baseY = lerp(shoreStartY, height, t)
            let px = baseX + random(40, 160)
            let py = baseY + random(0, 90)
            if (px > width + 10 || py > height + 10) continue
            let nn = noise(px / 50, py / 50)
            g.noStroke()
            g.fill(sandR - 15 + nn * 20, sandG - 15 + nn * 15, sandB - 10 + nn * 10, 50 + nn * 40)
            g.ellipse(px, py, nn * 6 + 2, nn * 4 + 2)
        }

        // --- Shoreline foam: soft white ellipses along the water's edge ---
        for (let i = 0; i < shorePoints.length; i++) {
            let p = shorePoints[i]
            let nn = noise(p.x / 25, p.y / 25)
            g.noStroke()
            g.fill(200, 210, 215, 100 + nn * 60)
            let rr = 4 + nn * 8
            g.ellipse(p.x + nn * 6 - 3, p.y + nn * 4 - 2, rr, rr * 0.4)
            // Sparse scattered bubbles at high-noise points
            if (nn > 0.55) {
                let ox = (noise(p.x, p.y + 1) - 0.5) * 25
                let oy = (noise(p.y, p.x + 1) - 0.5) * 15
                g.fill(210, 220, 225, 60 + nn * 50)
                g.ellipse(p.x + ox, p.y + oy, nn * 4, nn * 3)
            }
        }
    }

    // --- Birds: pairs of arcs that flap via sin(frameCount) ---
    for (var b = 0; b < birdCount; b++) {
        originalGraphics.push()
        originalGraphics.translate(noise(b) * width, noise(b * 50) * startHeight * 1.2)
        originalGraphics.scale(noise(b * 30) * 0.5 + 0.2)
        originalGraphics.stroke(0)
        originalGraphics.strokeWeight(4)
        let sc = abs(sin(frameCount / 10)) / 4
        originalGraphics.rotate(sc)
        originalGraphics.arc(0, 0, 20, 20, PI * 0.9, PI * 2.1)
        originalGraphics.rotate(-sc * 2)
        originalGraphics.arc(-20, 0, 20, 20, PI * 0.9, PI * 2.1)
        originalGraphics.pop()
    }

    // =========================================================================
    // SHADER POST-PROCESSING
    // The fragment shader samples originalGraphics with
    // noise-distorted UV coordinates, creating a painterly/oil-painting effect.
    // Multiple distorted samples are blended for richness.
    // =========================================================================
    webGLCanvas.shader(theShader)
    theShader.setUniform('u_resolution', [width / 1000, height / 1000])
    theShader.setUniform('u_time', millis() / 1000) //move
    theShader.setUniform('u_tex', originalGraphics)
    webGLCanvas.clear()
    webGLCanvas.rect(-width / 2, -height / 2, width, height)
    image(webGLCanvas, 0, 0)
    //image(originalGraphics, 0, 0)

    //spray particles with MULTIPLY blend (darkens where spray isn't)
    push()
    blendMode(MULTIPLY)
    image(overlayGraphics, 0, 0)
    pop()

    stroke(factors[0] * 0.7 + 50, factors[2] * 0.7 + 50, factors[4] * 0.7 + 50)
    strokeWeight(50)
    noFill()
    rect(0, 0, width, height)
}
