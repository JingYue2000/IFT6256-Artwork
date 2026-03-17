let allColors = ["#FF6B9D", "#C56CF0", "#FF9F43", "#FECA57", "#55E6C1"];
let authorExtPalette = [
  "#FF6B6B","#48DBFB","#FF9FF3","#54A0FF","#5F27CD",
  "#01A367","#F368E0","#EE5A24","#0652DD","#FDA7DF",
  "#B53471","#C4E538","#12CBC4","#ED4C67","#A3CB38",
  "#1289A7","#D980FA","#B33939","#218C74","#F19066"
];

function authorColorHash(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return authorExtPalette[Math.abs(hash) % authorExtPalette.length];
}

let rawData, dataLayer, interpreter, analyzer;
let nodes = [], waves = [], connections = [];
let paintLayer, overallTexture;
let waveScheduler = [];
let watchedEventCount = 0;

function preload() {
  let params = new URLSearchParams(window.location.search);
  let dataFile = params.get('data') || 'data.json';
  rawData = loadJSON(dataFile);
}

function setup() {
  pixelDensity(2);
  createCanvas(1000, 1000);

  paintLayer = createGraphics(width, height);
  paintLayer.background(252, 248, 242);

  overallTexture = createGraphics(width, height);
  overallTexture.loadPixels();
  for (let i = 0; i < width; i++) {
    for (let o = 0; o < height; o++) {
      overallTexture.set(i, o, color(150, noise(i / 10, i * o / 300) * random([0, 50, 100])));
    }
  }
  overallTexture.updatePixels();

  analyzer = new DataAnalyzer(rawData);
  dataLayer = new DataLayer(rawData);
  interpreter = new EventInterpreter(rawData.meta);

  let contributors = rawData.meta.contributors || [];
  let activeAuthors = analyzer.getActiveAuthors(2);

  // Contributors as cluster centers (larger nodes)
  for (let i = 0; i < contributors.length; i++) {
    let ang = (i / contributors.length) * TWO_PI - HALF_PI;
    let rad = min(width, height) * 0.38;
    let cx = width / 2 + cos(ang) * rad;
    let cy = height / 2 + sin(ang) * rad;
    nodes.push(new Node({
      p: createVector(cx, cy),
      clr: authorColorHash(contributors[i]),
      cluster: contributors[i],
      author: contributors[i],
      baseSize: analyzer.getBaseSize(contributors[i]) + 2
    }));
  }

  // Non-contributor active authors placed near their cluster center
  for (let author of activeAuthors) {
    if (contributors.includes(author)) continue;
    let cluster = analyzer.clusterMap[author];
    let centerNode = nodes.find(n => n.author === cluster);
    let cx, cy;
    if (centerNode) {
      let a = random(TWO_PI);
      let r = random(60, 160);
      cx = centerNode.p.x + cos(a) * r;
      cy = centerNode.p.y + sin(a) * r;
    } else {
      cx = width / 2 + random(-150, 150);
      cy = height / 2 + random(-150, 150);
    }
    nodes.push(new Node({
      p: createVector(constrain(cx, 40, width - 40), constrain(cy, 40, height - 40)),
      clr: authorColorHash(author),
      cluster: cluster,
      author: author,
      baseSize: analyzer.getBaseSize(author)
    }));
  }

  // Ambient nodes at center for unmatched authors
  for (let i = 0; i < 3; i++) {
    nodes.push(new Node({
      p: createVector(width / 2 + random(-50, 50), height / 2 + random(-50, 50)),
      clr: random(allColors),
      cluster: "_ambient",
      author: null,
      baseSize: random(4, 7)
    }));
  }

  startDataWatcher();
}


class DataAnalyzer {
  constructor(data) {
    this.contributors = data.meta.contributors || [];
    this.allAuthors = data.meta.allAuthors || data.meta.authors || [];
    this.authorStats = {};
    this.temporalLinks = {};
    this.clusterMap = {};

    for (let a of this.allAuthors) {
      this.authorStats[a] = { eventCount: 0, timestamps: [] };
    }

    for (let evt of data.events) {
      if (!evt.type || !evt.author) continue;
      let a = evt.author;
      if (!this.authorStats[a]) {
        this.authorStats[a] = { eventCount: 0, timestamps: [] };
      }
      this.authorStats[a].eventCount++;
      if (evt.timestamp) {
        this.authorStats[a].timestamps.push(new Date(evt.timestamp).getTime());
      }
    }

    // Build temporal co-occurrence (6-hour window)
    let SIX_HOURS = 6 * 60 * 60 * 1000;
    let authors = Object.keys(this.authorStats);
    for (let i = 0; i < authors.length; i++) {
      for (let j = i + 1; j < authors.length; j++) {
        let a1 = authors[i], a2 = authors[j];
        let score = 0;
        for (let t1 of this.authorStats[a1].timestamps) {
          for (let t2 of this.authorStats[a2].timestamps) {
            if (Math.abs(t1 - t2) < SIX_HOURS) score++;
          }
        }
        if (score > 0) {
          let key = a1 < a2 ? a1 + "|" + a2 : a2 + "|" + a1;
          this.temporalLinks[key] = score;
        }
      }
    }

    for (let c of this.contributors) {
      this.clusterMap[c] = c;
    }
    // Non-contributors: assign to most temporally linked contributor
    for (let a of this.allAuthors) {
      if (this.clusterMap[a]) continue;
      let bestCluster = null, bestScore = 0;
      for (let c of this.contributors) {
        let score = this.getTemporalScore(a, c);
        if (score > bestScore) { bestScore = score; bestCluster = c; }
      }
      this.clusterMap[a] = bestCluster || this.contributors[0] || "_ambient";
    }
  }

  getTemporalScore(a1, a2) {
    let key = a1 < a2 ? a1 + "|" + a2 : a2 + "|" + a1;
    return this.temporalLinks[key] || 0;
  }

  getBaseSize(author) {
    let stats = this.authorStats[author];
    let count = stats ? stats.eventCount : 0;
    let counts = Object.values(this.authorStats).map(s => s.eventCount).filter(c => c > 0);
    if (counts.length === 0) return 8;
    let maxCount = Math.max(...counts);
    let minCount = Math.min(...counts);
    if (maxCount === minCount) return 8;
    // Normalize event count to [0,1] then map to size range [5,14]
    let t = (count - minCount) / (maxCount - minCount);
    return 5 + t * 9;
  }

  getActiveAuthors(minEvents) {
    return Object.keys(this.authorStats).filter(a => this.authorStats[a].eventCount >= minEvents);
  }

  registerNewAuthor(author) {
    if (this.authorStats[author]) return;
    this.authorStats[author] = { eventCount: 0, timestamps: [] };
    this.clusterMap[author] = this.contributors[0] || "_ambient";
  }

  recordEvent(author) {
    if (!this.authorStats[author]) this.registerNewAuthor(author);
    this.authorStats[author].eventCount++;
    this.authorStats[author].timestamps.push(Date.now());
  }
}

function paintDab(pg, x, y, angle, clr, size, alpha) {
  pg.push();
  pg.translate(x, y);
  pg.rotate(angle);
  pg.noStroke();

  let c = color(clr);
  let rv = constrain(red(c) + random(-8, 8), 0, 255);
  let gv = constrain(green(c) + random(-8, 8), 0, 255);
  let bv = constrain(blue(c) + random(-8, 8), 0, 255);

  pg.drawingContext.shadowColor = "rgba(0,0,0," + (alpha * 0.08) + ")";
  pg.drawingContext.shadowBlur = 0;
  pg.drawingContext.shadowOffsetX = random(0.3, 1.2);
  pg.drawingContext.shadowOffsetY = random(0.3, 0.8);

  let w = size * random(3, 5);
  let h = size * random(0.4, 0.8);

  let cc = color(rv, gv, bv);
  cc.setAlpha(alpha * 220);
  pg.fill(cc);
  pg.ellipse(0, 0, w, h);

  // Highlight for thickness feel
  cc = color(min(rv + 20, 255), min(gv + 15, 255), min(bv + 10, 255));
  cc.setAlpha(alpha * 100);
  pg.fill(cc);
  pg.ellipse(random(-0.3, 0.3), random(-0.2, 0.2), w * 0.35, h * 0.25);

  pg.drawingContext.shadowOffsetX = 0;
  pg.drawingContext.shadowOffsetY = 0;
  pg.drawingContext.shadowColor = "rgba(0,0,0,0)";
  pg.pop();
}

function addConnection(nodeA, nodeB, clr) {
  connections.push(new Conn(nodeA, nodeB, clr));
  if (nodeA.author && nodeB.author) {
    nodeA.attractors[nodeB.author] = (nodeA.attractors[nodeB.author] || 0) + 1;
    nodeB.attractors[nodeA.author] = (nodeB.attractors[nodeA.author] || 0) + 1;
  }
}

function draw() {
  // Stagger scheduled ripples across frames
  for (let i = waveScheduler.length - 1; i >= 0; i--) {
    if (waveScheduler[i]()) waveScheduler.splice(i, 1);
  }

  // Slow fade — old paint gradually sinks into canvas
  if (frameCount % 8 === 0) {
    paintLayer.noStroke();
    paintLayer.fill(252, 248, 242, 1);
    paintLayer.rect(0, 0, width, height);
  }

  let evt = dataLayer.getNextEvent();
  if (evt) {
    // Register unknown live authors
    if (evt.author && !analyzer.authorStats[evt.author]) {
      analyzer.registerNewAuthor(evt.author);
      let cluster = analyzer.clusterMap[evt.author];
      let centerNode = nodes.find(n => n.author === cluster);
      let cx, cy;
      if (centerNode) {
        let a = random(TWO_PI);
        let r = random(60, 160);
        cx = centerNode.p.x + cos(a) * r;
        cy = centerNode.p.y + sin(a) * r;
      } else {
        cx = width / 2 + random(-150, 150);
        cy = height / 2 + random(-150, 150);
      }
      nodes.push(new Node({
        p: createVector(constrain(cx, 40, width - 40), constrain(cy, 40, height - 40)),
        clr: authorColorHash(evt.author),
        cluster: cluster,
        author: evt.author,
        baseSize: 7
      }));
    }
    if (evt.author) analyzer.recordEvent(evt.author);

    let cmd = interpreter.interpret(evt);
    if (cmd) {
      let targetNode = nodes.find(n => n.author === evt.author);
      if (!targetNode) {
        let cluster = (analyzer.clusterMap[evt.author]) || "_ambient";
        let clusterNodes = nodes.filter(n => n.cluster === cluster);
        targetNode = clusterNodes.length > 0 ? random(clusterNodes) : random(nodes);
      }
      targetNode.receiveEvent(cmd);

      // Connection rules by event type
      if (evt.type === "PullRequestEvent") {
        let cluster = analyzer.clusterMap[evt.author] || "_ambient";
        let clusterContrib = nodes.find(n =>
          n.author !== evt.author && n.cluster === cluster &&
          analyzer.contributors.includes(n.author));
        if (clusterContrib) {
          addConnection(targetNode, clusterContrib, targetNode.clr);
        }
      } else if (evt.type === "IssuesEvent") {
        for (let n of nodes) {
          if (n.author !== evt.author && analyzer.contributors.includes(n.author)) {
            addConnection(targetNode, n, targetNode.clr);
          }
        }
      } else if (evt.type === "MergeEvent") {
        for (let n of nodes) {
          if (n.author && n.author !== evt.author) {
            addConnection(targetNode, n, targetNode.clr);
          }
        }
      }
    }
  }

  image(paintLayer, 0, 0);

  for (let i = connections.length - 1; i >= 0; i--) {
    connections[i].update();
    connections[i].stampPaint(paintLayer);
    connections[i].draw();
    if (!connections[i].alive) connections.splice(i, 1);
  }

  for (let i = waves.length - 1; i >= 0; i--) {
    waves[i].update();
    waves[i].stampPaint(paintLayer);
    waves[i].draw();
    if (!waves[i].alive) waves.splice(i, 1);
  }
  while (waves.length > 120) waves.shift();

  for (let i = 0; i < nodes.length; i++) {
    nodes[i].update();
    nodes[i].stampPaint(paintLayer);
    nodes[i].draw();
  }

  push();
  blendMode(MULTIPLY);
  image(overallTexture, 0, 0);
  pop();

  drawHUD();
}


class Wave {
  constructor(args) {
    this.p = args.p.copy();
    this.clr = args.clr;
    this.rSpeed = args.rSpeed || random(0.8, 2.2);
    this.r = 0;
    this.maxR = args.maxR || random(150, 350);
    this.alive = true;
    this.visualType = args.visualType || "ripple";
    this.ringCount = args.ringCount || int(random(2, 5));
    this.wobbleSeed = random(100);
  }

  draw() {
    let life = constrain(1 - this.r / this.maxR, 0, 1);
    if (life <= 0) return;

    let c = color(this.clr);
    let rv = red(c), gv = green(c), bv = blue(c);

    for (let ring = 0; ring < this.ringCount; ring++) {
      let ringR = this.r * (1 - ring * 0.18);
      if (ringR < 2) continue;

      let alpha = life * (160 - ring * 30);
      let sw = map(life, 0, 1, 0.5, 3.5 - ring * 0.5);

      noFill();

      // Soft glow behind stroke
      stroke(rv, gv, bv, alpha * 0.25);
      strokeWeight(sw + 5);
      if (this.visualType === "ripple" || this.visualType === "glow") {
        ellipse(this.p.x, this.p.y, ringR * 2, ringR * 2);
      }

      stroke(rv, gv, bv, alpha);
      strokeWeight(sw);

      if (this.visualType === "distortion") {
        beginShape();
        for (let s = 0; s <= 50; s++) {
          let ang = (s / 50) * TWO_PI;
          let disp = sin(ang * 5 + frameCount * 0.08 + this.wobbleSeed) * ringR * 0.12;
          vertex(this.p.x + cos(ang) * (ringR + disp),
                 this.p.y + sin(ang) * (ringR + disp));
        }
        endShape(CLOSE);
      } else if (this.visualType === "burst") {
        beginShape();
        for (let s = 0; s <= 40; s++) {
          let ang = (s / 40) * TWO_PI;
          let spike = (s % 2 === 0) ? ringR * 1.08 : ringR * 0.92;
          vertex(this.p.x + cos(ang) * spike,
                 this.p.y + sin(ang) * spike);
        }
        endShape(CLOSE);
      } else {
        ellipse(this.p.x, this.p.y, ringR * 2, ringR * 2);
      }
    }
  }

  stampPaint(pg) {
    let life = constrain(1 - this.r / this.maxR, 0, 1);
    if (life <= 0 || this.r < 8) return;

    let stampCount = int(map(life, 0, 1, 1, 3));
    let brushSize = map(life, 0, 1, 2, 4);

    for (let s = 0; s < stampCount; s++) {
      let ang = random(TWO_PI);
      let wobble = 0;
      if (this.visualType === "distortion") {
        wobble = sin(ang * 5 + frameCount * 0.08 + this.wobbleSeed) * this.r * 0.12;
      }
      let r = this.r + wobble + random(-1.5, 1.5);

      if (this.visualType === "burst") {
        let spike = (int(ang * 10) % 2 === 0) ? 1.08 : 0.92;
        r = this.r * spike;
      }

      let px = this.p.x + cos(ang) * r;
      let py = this.p.y + sin(ang) * r;
      let tangent = ang + HALF_PI;

      paintDab(pg, px, py, tangent, this.clr, brushSize, life * 0.25);
    }
  }

  update() {
    this.r += this.rSpeed;
    if (this.r >= this.maxR) this.alive = false;
  }
}


class Node {
  constructor(args) {
    this.p = args.p;
    this.initP = args.p.copy();
    this.clr = args.clr;
    this.cluster = args.cluster;
    this.lastEmitTs = 0;
    this.glowAmt = 0;
    this.eventQueue = [];
    this.baseSize = args.baseSize || random(5, 11);
    this.pulseOff = random(100);
    this.hitFlash = 0;
    this.author = args.author || null;
    this.vel = createVector(0, 0);
    this.attractors = {};
    this.visibility = 1.0;
  }

  receiveEvent(cmd) {
    this.eventQueue.push(cmd);
  }

  stampPaint(pg) {
    if (this.hitFlash > 0.5) {
      paintDab(pg, this.p.x + random(-2, 2), this.p.y + random(-2, 2),
        random(TWO_PI), this.clr, this.baseSize * 0.7, this.hitFlash * 0.5);
    }
    if (random() < 0.005) {
      paintDab(pg, this.p.x, this.p.y,
        random(TWO_PI), this.clr, this.baseSize * 0.3, 0.2);
    }
  }

  draw() {
    if (this.visibility < 0.01) return;

    let pulse = 1 + sin(frameCount * 0.05 + this.pulseOff) * 0.15;
    let sz = this.baseSize * pulse;
    let c = color(this.clr);
    let rv = red(c), gv = green(c), bv = blue(c);
    let v = this.visibility;

    let glowR = sz + 6 + this.glowAmt * 8 + this.hitFlash * 15;
    let ctx = drawingContext;
    let grad = ctx.createRadialGradient(this.p.x, this.p.y, sz * 0.2, this.p.x, this.p.y, glowR);
    let glowAlpha = (0.3 + this.hitFlash * 0.4) * v;
    grad.addColorStop(0, "rgba(" + rv + "," + gv + "," + bv + "," + glowAlpha + ")");
    grad.addColorStop(0.5, "rgba(" + rv + "," + gv + "," + bv + "," + (glowAlpha * 0.25) + ")");
    grad.addColorStop(1, "rgba(" + rv + "," + gv + "," + bv + ",0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.p.x, this.p.y, glowR, 0, TWO_PI);
    ctx.fill();

    noStroke();
    let cc = color(this.clr);
    cc.setAlpha(255 * v);
    fill(cc);
    ellipse(this.p.x, this.p.y, sz, sz);
    fill(255, 255, 255, (100 + this.hitFlash * 150) * v);
    ellipse(this.p.x, this.p.y, sz * 0.35, sz * 0.35);
  }

  update() {
    if (this.eventQueue.length > 0 && frameCount - this.lastEmitTs > 15) {
      this.processEvent(this.eventQueue.shift());
    }
    this.glowAmt *= 0.992;
    this.hitFlash *= 0.9;

    if (this.hitFlash > 0.01 || this.eventQueue.length > 0) {
      this.visibility = 1.0;
    } else {
      this.visibility *= 0.995;
    }

    // Force-directed layout — only active when node has connections
    let hasAttractors = Object.keys(this.attractors).length > 0;
    if (hasAttractors) {
      for (let key in this.attractors) {
        this.attractors[key] *= 0.99;
        if (this.attractors[key] < 0.01) delete this.attractors[key];
      }

      for (let other of nodes) {
        if (other === this) continue;
        let d = this.p.dist(other.p);

        if (d < 80 && d > 0.1) {
          let repel = p5.Vector.sub(this.p, other.p).normalize().mult(0.5);
          this.vel.add(repel);
        }

        let strength = (other.author && this.attractors[other.author]) || 0;
        if (strength > 0 && d > 100) {
          let attract = p5.Vector.sub(other.p, this.p).normalize().mult(min(strength * 0.008, 0.5));
          this.vel.add(attract);
        }
      }

      let toCenter = p5.Vector.sub(createVector(width / 2, height / 2), this.p).mult(0.0005);
      this.vel.add(toCenter);

      this.vel.mult(0.85);

      if (this.vel.mag() < 0.01) {
        this.vel.set(0, 0);
      }

      this.p.add(this.vel);

      this.p.x = constrain(this.p.x, 30, width - 30);
      this.p.y = constrain(this.p.y, 30, height - 30);
    }
  }

  emitWave(clrOverride, vType, opts) {
    this.lastEmitTs = frameCount;
    waves.push(new Wave({
      p: this.p, clr: clrOverride || this.clr,
      parent: this, visualType: vType || "ripple",
      ...(opts || {})
    }));
  }

  processEvent(cmd) {
    this.lastEmitTs = frameCount;
    this.hitFlash = 1;
    switch (cmd.visualType) {
      case "ripple": {
        let count = cmd.count || 1;
        let node = this;
        for (let i = 0; i < count; i++) {
          let frame = frameCount + i * 8;
          waveScheduler.push(() => {
            if (frameCount >= frame) {
              node.emitWave(node.clr, "ripple", {
                rSpeed: cmd.speed || random(1, 2.5),
                maxR: map(cmd.size || 100, 60, 180, 150, 350),
                ringCount: int(random(2, 4))
              });
              return true;
            }
            return false;
          });
        }
        break;
      }
      case "burst": {
        let burstClr = cmd.isMerge ? lerpColor(color(this.clr), color(255), 0.5) : this.clr;
        this.emitWave(burstClr, "burst", {
          rSpeed: cmd.speed || 3,
          maxR: cmd.maxR || map(cmd.size || 120, 80, 200, 200, 400),
          ringCount: cmd.ringCount || int(random(3, 6))
        });
        break;
      }
      case "distortion":
        this.emitWave(this.clr, "distortion", {
          rSpeed: 1.2 * (cmd.urgency || 1), maxR: 300, ringCount: int(random(3, 5))
        });
        break;
      case "glow":
        this.glowAmt = min(this.glowAmt + 5, 10);
        this.emitWave(this.clr, "ripple", {
          rSpeed: 0.6, maxR: 120, ringCount: 2
        });
        break;
    }
  }
}


class Conn {
  constructor(a, b, clr) {
    this.a = a; this.b = b; this.clr = clr;
    this.life = 1.0; this.decay = 0.004; this.alive = true;
    this.flowOff = random(100);
    this.curveMag = random(0.12, 0.25) * (random() < 0.5 ? 1 : -1);
  }

  draw() {
    let c = color(this.clr);
    let rv = red(c), gv = green(c), bv = blue(c);

    let dx = this.b.p.x - this.a.p.x, dy = this.b.p.y - this.a.p.y;
    let mx = (this.a.p.x + this.b.p.x) / 2, my = (this.a.p.y + this.b.p.y) / 2;
    let cpx = mx - dy * this.curveMag, cpy = my + dx * this.curveMag;

    let ctx = drawingContext;

    ctx.strokeStyle = "rgba(" + rv + "," + gv + "," + bv + "," + (this.life * 0.5) + ")";
    ctx.lineWidth = 4 * this.life;
    ctx.beginPath();
    ctx.moveTo(this.a.p.x, this.a.p.y);
    ctx.quadraticCurveTo(cpx, cpy, this.b.p.x, this.b.p.y);
    ctx.stroke();

    ctx.strokeStyle = "rgba(" + rv + "," + gv + "," + bv + "," + (this.life * 0.85) + ")";
    ctx.lineWidth = 1.5 * this.life;
    ctx.beginPath();
    ctx.moveTo(this.a.p.x, this.a.p.y);
    ctx.quadraticCurveTo(cpx, cpy, this.b.p.x, this.b.p.y);
    ctx.stroke();

    // Flowing dots along curve
    let flowT = (frameCount * 0.015 + this.flowOff) % 1;
    for (let i = 0; i < 5; i++) {
      let t = (flowT + i * 0.2) % 1;
      let bx = (1-t)*(1-t)*this.a.p.x + 2*(1-t)*t*cpx + t*t*this.b.p.x;
      let by = (1-t)*(1-t)*this.a.p.y + 2*(1-t)*t*cpy + t*t*this.b.p.y;
      let dotA = sin(t * PI) * this.life;
      ctx.fillStyle = "rgba(" + rv + "," + gv + "," + bv + "," + (dotA * 0.9) + ")";
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, TWO_PI); ctx.fill();
    }
  }

  stampPaint(pg) {
    if (random() > 0.2) return;

    let dx = this.b.p.x - this.a.p.x, dy = this.b.p.y - this.a.p.y;
    let mx = (this.a.p.x + this.b.p.x) / 2, my = (this.a.p.y + this.b.p.y) / 2;
    let cpx = mx - dy * this.curveMag, cpy = my + dx * this.curveMag;

    let t = random();
    let bx = (1-t)*(1-t)*this.a.p.x + 2*(1-t)*t*cpx + t*t*this.b.p.x;
    let by = (1-t)*(1-t)*this.a.p.y + 2*(1-t)*t*cpy + t*t*this.b.p.y;
    let tx = 2*(1-t)*(cpx - this.a.p.x) + 2*t*(this.b.p.x - cpx);
    let ty = 2*(1-t)*(cpy - this.a.p.y) + 2*t*(this.b.p.y - cpy);
    let tangent = atan2(ty, tx);

    let widthMult = sin(t * PI);
    paintDab(pg, bx, by, tangent, this.clr,
      4 * (0.4 + widthMult * 0.6) * this.life, this.life * 0.45);
  }

  update() {
    this.life -= this.decay;
    if (this.life <= 0) this.alive = false;
  }
}


class DataLayer {
  constructor(data) {
    this.events = data.events || [];
    this.currentIndex = 0;
    this.speed = 1;
    this.lastEmitFrame = 0;
    this.finished = false;
    this.liveQueue = [];
  }
  appendLiveEvents(events) {
    for (let e of events) this.liveQueue.push(e);
  }
  getNextEvent() {
    if (frameCount - this.lastEmitFrame < floor(60 / this.speed)) return null;
    if (!this.finished && this.events.length) {
      this.lastEmitFrame = frameCount;
      while (this.currentIndex < this.events.length) {
        let e = this.events[this.currentIndex];
        this.currentIndex++;
        if (e.type) return e;
      }
      this.finished = true;
    }
    if (this.liveQueue.length > 0) {
      this.lastEmitFrame = frameCount;
      return this.liveQueue.shift();
    }
    return null;
  }
  restart() {
    this.currentIndex = 0; this.lastEmitFrame = frameCount;
    this.finished = false; this.liveQueue = [];
  }
}

class EventInterpreter {
  constructor(meta) {}
  interpret(evt) {
    switch (evt.type) {
      case "PushEvent":
        return { visualType:"ripple",
          count:constrain(evt.data.commits,1,5),
          size:map(evt.data.additions+evt.data.deletions,0,250,60,180),
          speed:map(evt.data.commits,1,5,1.5,3.5) };
      case "PullRequestEvent":
        return { visualType:"burst",
          size:map(evt.data.additions+evt.data.deletions,0,300,80,200), speed:3 };
      case "IssuesEvent":
        return { visualType:"distortion",
          urgency:(evt.data.labels&&evt.data.labels.includes("urgent"))?1.5:1.0, size:90, speed:1.5 };
      case "WatchEvent":
        return { visualType:"glow" };
      case "MergeEvent":
        return { visualType:"burst", isMerge:true,
          maxR:300, ringCount:5, speed:2 };
      default: return null;
    }
  }
}


// Poll data.json for live updates from fetch-data.js
function startDataWatcher() {
  watchedEventCount = rawData.events.length;
  setInterval(async () => {
    try {
      let resp = await fetch('data.json?_=' + Date.now());
      let data = await resp.json();
      if (data.events.length > watchedEventCount) {
        let newEvents = data.events.slice(watchedEventCount);
        dataLayer.appendLiveEvents(newEvents);
        watchedEventCount = data.events.length;
      }
    } catch (e) {}
  }, 5000);
}

function drawHUD() {
}

function keyPressed() {
  if (key === " ") { isLooping() ? noLoop() : loop(); }
  if (key === "s") save();
  if (key === "r") {
    dataLayer.restart(); waves=[]; connections=[]; waveScheduler=[];
    paintLayer.background(252, 248, 242);
    nodes.forEach(n => {
      n.glowAmt=0; n.hitFlash=0; n.eventQueue=[];
      n.vel = createVector(0, 0);
      n.attractors = {};
      n.p = n.initP.copy();
    });
    watchedEventCount = 0;
  }
  if (keyCode === UP_ARROW) dataLayer.speed = constrain(dataLayer.speed+0.5, 0.5, 10);
  if (keyCode === DOWN_ARROW) dataLayer.speed = constrain(dataLayer.speed-0.5, 0.5, 10);
}
