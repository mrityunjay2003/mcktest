/* ============================= state ============================= */
let paper = []; // normalized questions
let durationSec = 0; // total test seconds
let remaining = 0;
let cur = 0; // current question index
let answers = []; // selected option index or null
let visited = []; // bool
let marked = []; // bool
let timeSpent = []; // seconds (float) per question
let enteredAt = null; // timestamp when current question was entered
let mainTimer = null,
  qTimerTick = null;
let testStartedAt = null,
  testEndedAt = null;

const $ = (id) => document.getElementById(id);

/* ============================= helpers ============================= */
function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  return (
    (h ? String(h).padStart(2, "0") + ":" : "") +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}
function fmtDur(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60),
    s = sec % 60;
  return m ? m + "m " + s + "s" : s + "s";
}
function show(screen) {
  document
    .querySelectorAll(".screen")
    .forEach((x) => x.classList.remove("active"));
  $(screen).classList.add("active");
  window.scrollTo(0, 0);
}

/* ============================= parsing ============================= */
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function normalizePaper(raw) {
  let arr = raw;
  if (!Array.isArray(arr) && arr && typeof arr === "object") {
    arr = pick(arr, ["questions", "data", "paper", "items"]);
  }
  if (!Array.isArray(arr) || !arr.length)
    throw new Error(
      'Expected a JSON array of questions (or an object with a "questions" array).',
    );

  const out = [];
  arr.forEach((q, i) => {
    const where = "Question at position " + (i + 1);
    if (typeof q !== "object" || q === null)
      throw new Error(where + " is not an object.");
    const text = pick(q, [
      "question",
      "questionText",
      "question_text",
      "text",
      "q",
    ]);
    if (!text) throw new Error(where + ': missing "question" text.');
    let options = pick(q, ["options", "choices", "opts"]);
    if (!Array.isArray(options) || options.length < 2)
      throw new Error(
        where + ': "options" must be an array with at least 2 entries.',
      );
    options = options.map((o) =>
      typeof o === "object" && o !== null
        ? String(
            pick(o, ["text", "option", "value", "label"]) ?? JSON.stringify(o),
          )
        : String(o),
    );

    const rawAns = pick(q, [
      "correctAnswer",
      "correct_answer",
      "answer",
      "correct",
      "ans",
      "correctOption",
      "correct_option",
    ]);
    if (rawAns === undefined)
      throw new Error(where + ': missing "correctAnswer".');
    const ci = resolveAnswer(rawAns, options);
    if (ci === -1)
      throw new Error(
        where +
          ': correctAnswer "' +
          rawAns +
          '" does not match any option (use the option text, a letter like "B", or a 1-based number).',
      );

    out.push({
      num:
        pick(q, [
          "questionNumber",
          "question_number",
          "qno",
          "qNo",
          "sno",
          "number",
          "id",
        ]) ?? i + 1,
      question: String(text),
      askedIn: String(
        pick(q, ["askedIn", "asked_in", "exam", "source", "paper"]) ?? "—",
      ),
      options,
      correct: ci,
    });
  });
  return out;
}

function resolveAnswer(ans, options) {
  // 1. exact / trimmed / case-insensitive text match
  const norm = (s) => String(s).trim().toLowerCase();
  const byText = options.findIndex((o) => norm(o) === norm(ans));
  if (byText !== -1) return byText;
  // 2. single letter A..Z (also "(b)", "b)")
  const m = String(ans)
    .trim()
    .match(/^\(?([A-Za-z])\)?$/);
  if (m) {
    const idx = m[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return idx;
  }
  // 3. numeric: 1-based first, else 0 means first option
  const n = Number(ans);
  if (Number.isInteger(n)) {
    if (n >= 1 && n <= options.length) return n - 1;
    if (n === 0) return 0;
  }
  return -1;
}

/* ============================= setup screen ============================= */
const SAMPLE = [
  {
    questionNumber: 1,
    askedIn: "SSC CGL 2025 (Tier I)",
    question:
      "If the ratio of two numbers is 3 : 5 and their HCF is 4, what is their LCM?",
    options: ["15", "60", "64", "80"],
    correctAnswer: "60",
  },
  {
    questionNumber: 2,
    askedIn: "SSC CGL 2024",
    question: "Choose the word most nearly OPPOSITE in meaning to:  FRUGAL",
    options: ["Thrifty", "Extravagant", "Careful", "Miserly"],
    correctAnswer: "B",
  },
  {
    questionNumber: 3,
    askedIn: "SSC CHSL 2025",
    question:
      "Who among the following was the first woman to become a judge of the Supreme Court of India?",
    options: ["Leila Seth", "Anna Chandy", "Fathima Beevi", "Ruma Pal"],
    correctAnswer: "Fathima Beevi",
  },
  {
    questionNumber: 4,
    askedIn: "SSC CGL 2025 (Tier I)",
    question:
      "A train 240 m long crosses a pole in 12 seconds. What is its speed in km/h?",
    options: ["60", "66", "72", "80"],
    correctAnswer: 3,
  },
  {
    questionNumber: 5,
    askedIn: "SSC MTS 2024",
    question:
      "In a certain code, TEACHER is written as VGCEJGT. How is STUDENT written in that code?",
    options: ["UVWFGPV", "UVWFGPU", "UWVFGPV", "UVWEGPV"],
    correctAnswer: "UVWFGPV",
  },
  {
    questionNumber: 6,
    askedIn: "SSC CGL 2023",
    question:
      "The Fundamental Duties were added to the Constitution of India by which Amendment?",
    options: [
      "24th Amendment",
      "42nd Amendment",
      "44th Amendment",
      "52nd Amendment",
    ],
    correctAnswer: "42nd Amendment",
  },
  {
    questionNumber: 7,
    askedIn: "SSC CPO 2025",
    question:
      "The average of 5 consecutive odd numbers is 27. What is the largest of these numbers?",
    options: ["29", "31", "33", "35"],
    correctAnswer: "31",
  },
  {
    questionNumber: 8,
    askedIn: "SSC CGL 2025 (Tier I)",
    question: "Select the correctly spelt word:",
    options: ["Occassion", "Ocassion", "Occasion", "Occasionn"],
    correctAnswer: "Occasion",
  },
];

function tryLoadFromTextarea() {
  const t = $("jsonInput").value.trim();
  const status = $("loadStatus");
  if (!t) {
    status.className = "";
    status.style.display = "none";
    paper = [];
    $("startBtn").disabled = true;
    return;
  }
  try {
    paper = normalizePaper(JSON.parse(t));
    status.className = "ok";
    status.textContent =
      "✓ Loaded " +
      paper.length +
      " questions. Suggested time: " +
      paper.length +
      " min.";
    if (!(+$("durationInput").value > 0))
      $("durationInput").value = paper.length;
    $("startBtn").disabled = false;
  } catch (e) {
    paper = [];
    $("startBtn").disabled = true;
    status.className = "err";
    status.textContent =
      "✗ " +
      (e instanceof SyntaxError ? "Invalid JSON — " + e.message : e.message);
  }
}
$("jsonInput").addEventListener("input", debounce(tryLoadFromTextarea, 350));
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

$("sampleBtn").addEventListener("click", () => {
  $("jsonInput").value = JSON.stringify(SAMPLE, null, 2);
  tryLoadFromTextarea();
});

$("fileInput").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    $("jsonInput").value = r.result;
    tryLoadFromTextarea();
  };
  r.onerror = () => {
    const s = $("loadStatus");
    s.className = "err";
    s.textContent = "✗ Could not read the file.";
  };
  r.readAsText(f);
  e.target.value = "";
});

$("startBtn").addEventListener("click", startTest);

/* ============================= test flow ============================= */
function startTest() {
  const mins = Math.max(
    1,
    Math.min(600, +$("durationInput").value || paper.length),
  );
  durationSec = mins * 60;
  remaining = durationSec;
  answers = paper.map(() => null);
  visited = paper.map(() => false);
  marked = paper.map(() => false);
  timeSpent = paper.map(() => 0);
  cur = 0;
  testStartedAt = Date.now();
  testEndedAt = null;

  $("testTitle").textContent =
    "Mock Test · " + paper.length + " questions · " + mins + " min";
  buildPalette();
  show("test");
  goTo(0, true);

  clearInterval(mainTimer);
  mainTimer = setInterval(() => {
    remaining--;
    renderClock();
    if (remaining <= 0) finishTest(true);
  }, 1000);
  renderClock();
}

function renderClock() {
  const c = $("clock");
  c.textContent = fmtClock(remaining);
  c.classList.toggle("warn", remaining <= durationSec * 0.25 && remaining > 60);
  c.classList.toggle("danger", remaining <= 60);
}

function commitTime() {
  if (enteredAt !== null && cur >= 0 && cur < paper.length) {
    timeSpent[cur] += (Date.now() - enteredAt) / 1000;
  }
  enteredAt = null;
}

function goTo(i, first = false) {
  if (!first) commitTime();
  cur = i;
  visited[cur] = true;
  enteredAt = Date.now();
  renderQuestion();
  renderPalette();
  clearInterval(qTimerTick);
  qTimerTick = setInterval(renderQTimer, 500);
  renderQTimer();
}

function renderQTimer() {
  const live =
    timeSpent[cur] + (enteredAt ? (Date.now() - enteredAt) / 1000 : 0);
  const m = Math.floor(live / 60),
    s = Math.floor(live % 60);
  $("qTimer").textContent = m + ":" + String(s).padStart(2, "0");
}

function renderQuestion() {
  const q = paper[cur];
  $("testProgress").textContent =
    "QUESTION " + (cur + 1) + " / " + paper.length;
  $("qNumLabel").textContent = q.num;
  $("askedInTag").textContent = q.askedIn;
  $("qText").textContent = q.question;

  const list = $("optList");
  list.innerHTML = "";
  q.options.forEach((o, oi) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt" + (answers[cur] === oi ? " selected" : "");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", answers[cur] === oi ? "true" : "false");
    b.innerHTML =
      '<span class="bubble">' +
      String.fromCharCode(65 + oi) +
      '</span><span class="otext">' +
      esc(o) +
      "</span>";
    b.addEventListener("click", () => {
      answers[cur] = answers[cur] === oi ? null : oi;
      renderQuestion();
      renderPalette();
    });
    list.appendChild(b);
  });

  $("prevBtn").disabled = cur === 0;
  $("nextBtn").textContent =
    cur === paper.length - 1 ? "Save (last question)" : "Save & next →";
  $("markBtn").textContent = marked[cur] ? "Unmark review" : "Mark for review";
}

function buildPalette() {
  const g = $("pgrid");
  g.innerHTML = "";
  paper.forEach((q, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pbtn";
    b.textContent = i + 1;
    b.setAttribute("aria-label", "Go to question " + (i + 1));
    b.addEventListener("click", () => goTo(i));
    g.appendChild(b);
  });
}
function renderPalette() {
  [...$("pgrid").children].forEach((b, i) => {
    b.className =
      "pbtn" +
      (answers[i] !== null ? " answered" : visited[i] ? " seen" : "") +
      (marked[i] ? " marked" : "") +
      (i === cur ? " current" : "");
  });
}

$("prevBtn").addEventListener("click", () => {
  if (cur > 0) goTo(cur - 1);
});
$("nextBtn").addEventListener("click", () => {
  if (cur < paper.length - 1) goTo(cur + 1);
  else {
    commitTime();
    enteredAt = Date.now();
    renderPalette();
  }
});
$("clearBtn").addEventListener("click", () => {
  answers[cur] = null;
  renderQuestion();
  renderPalette();
});
$("markBtn").addEventListener("click", () => {
  marked[cur] = !marked[cur];
  renderQuestion();
  renderPalette();
});

$("submitBtn").addEventListener("click", () => {
  const un = answers.filter((a) => a === null).length;
  const msg = un
    ? "You still have " +
      un +
      " unanswered question" +
      (un > 1 ? "s" : "") +
      ". Submit anyway?"
    : "Submit the test?";
  if (confirm(msg)) finishTest(false);
});

document.addEventListener("keydown", (e) => {
  if (!$("test").classList.contains("active")) return;
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight" && cur < paper.length - 1) goTo(cur + 1);
  if (e.key === "ArrowLeft" && cur > 0) goTo(cur - 1);
  const k = e.key.toUpperCase().charCodeAt(0) - 65; // A,B,C,D…
  if (k >= 0 && k < paper[cur].options.length && /^[a-zA-Z]$/.test(e.key)) {
    answers[cur] = answers[cur] === k ? null : k;
    renderQuestion();
    renderPalette();
  }
});

function finishTest(auto) {
  commitTime();
  clearInterval(mainTimer);
  clearInterval(qTimerTick);
  testEndedAt = Date.now();
  buildResults(auto);
  show("results");
}

/* ============================= results ============================= */
function buildResults(auto) {
  const n = paper.length;
  let correct = 0,
    wrong = 0,
    skipped = 0;
  const outcome = paper.map((q, i) => {
    if (answers[i] === null) {
      skipped++;
      return "skipped";
    }
    if (answers[i] === q.correct) {
      correct++;
      return "correct";
    }
    wrong++;
    return "wrong";
  });
  const attempted = correct + wrong;
  const accuracy = attempted ? Math.round((correct / attempted) * 100) : 0;
  const usedSec = Math.min(
    durationSec,
    Math.round((testEndedAt - testStartedAt) / 1000),
  );
  const avg = timeSpent.reduce((a, b) => a + b, 0) / n;

  $("verdictTitle").textContent = auto
    ? "Time's up — auto-submitted"
    : "Test complete";
  $("scoreBig").textContent = correct + " / " + n;
  $("accBig").textContent = accuracy + "%";

  $("statRow").innerHTML = [
    ["c", correct, "Correct"],
    ["w", wrong, "Wrong"],
    ["s", skipped, "Skipped"],
    ["", attempted, "Attempted"],
    ["", fmtDur(usedSec), "Time used of " + fmtDur(durationSec)],
    ["", fmtDur(avg), "Avg time / question"],
  ]
    .map(
      ([cls, v, l]) =>
        '<div class="stat ' +
        cls +
        '"><div class="v">' +
        v +
        '</div><div class="l">' +
        l +
        "</div></div>",
    )
    .join("");

  buildChart(outcome, avg);
  buildInsights(outcome, avg, correct, wrong, skipped, usedSec);
  buildReview(outcome);
}

function colorFor(o) {
  return o === "correct"
    ? "var(--correct)"
    : o === "wrong"
      ? "var(--wrong)"
      : "var(--warn)";
}

function buildChart(outcome, avg) {
  const n = paper.length;
  const barW = 34,
    gap = 12,
    padL = 46,
    padB = 26,
    padT = 14;
  const W = padL + n * (barW + gap) + 10;
  const H = 220;
  const maxT = Math.max(10, ...timeSpent, avg * 1.2);
  const y = (v) => padT + (H - padB - padT) * (1 - v / maxT);

  let s =
    '<svg width="' +
    Math.max(W, 320) +
    '" height="' +
    H +
    '" role="img" aria-label="Bar chart of time spent per question" style="display:block">';
  // gridlines
  for (let g = 0; g <= 4; g++) {
    const v = (maxT * g) / 4,
      yy = y(v);
    s +=
      '<line x1="' +
      padL +
      '" y1="' +
      yy +
      '" x2="' +
      (W - 6) +
      '" y2="' +
      yy +
      '" stroke="var(--line)" stroke-width="1"/>';
    s +=
      '<text x="' +
      (padL - 8) +
      '" y="' +
      (yy + 4) +
      '" text-anchor="end" font-size="10" font-family="var(--mono)" fill="var(--muted)">' +
      Math.round(v) +
      "s</text>";
  }
  // average line
  s +=
    '<line x1="' +
    padL +
    '" y1="' +
    y(avg) +
    '" x2="' +
    (W - 6) +
    '" y2="' +
    y(avg) +
    '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>';
  // bars
  timeSpent.forEach((t, i) => {
    const x = padL + i * (barW + gap);
    const h = Math.max(2, (H - padB - padT) * (t / maxT));
    s +=
      '<rect x="' +
      x +
      '" y="' +
      (H - padB - h) +
      '" width="' +
      barW +
      '" height="' +
      h +
      '" rx="4" fill="' +
      colorFor(outcome[i]) +
      '"><title>Q' +
      (i + 1) +
      " · " +
      fmtDur(t) +
      " · " +
      outcome[i] +
      "</title></rect>";
    s +=
      '<text x="' +
      (x + barW / 2) +
      '" y="' +
      (H - 8) +
      '" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--muted)">' +
      (i + 1) +
      "</text>";
  });
  s += "</svg>";
  $("chartWrap").innerHTML = s;
}

function buildInsights(outcome, avg, correct, wrong, skipped, usedSec) {
  const ins = [];
  const n = paper.length;

  // slowest question
  let slow = timeSpent.indexOf(Math.max(...timeSpent));
  if (timeSpent[slow] > 0) {
    ins.push([
      "⏱",
      "Q" +
        (slow + 1) +
        " took the longest — " +
        fmtDur(timeSpent[slow]) +
        " (" +
        outcome[slow] +
        "). " +
        (outcome[slow] !== "correct"
          ? "Long time with no payoff: a strong candidate to skip early and revisit."
          : "It paid off, but check if it was worth the budget."),
    ]);
  }
  // fastest correct
  const fcIdx = timeSpent
    .map((t, i) => ({ t, i }))
    .filter((x) => outcome[x.i] === "correct")
    .sort((a, b) => a.t - b.t)[0];
  if (fcIdx)
    ins.push([
      "⚡",
      "Fastest correct answer: Q" +
        (fcIdx.i + 1) +
        " in " +
        fmtDur(fcIdx.t) +
        ".",
    ]);
  // rushed mistakes
  const rushed = outcome
    .map((o, i) =>
      o === "wrong" && timeSpent[i] < Math.min(15, avg * 0.5) ? i : -1,
    )
    .filter((i) => i >= 0);
  if (rushed.length)
    ins.push([
      "🚩",
      rushed.length +
        " wrong answer" +
        (rushed.length > 1 ? "s" : "") +
        " came in under " +
        Math.round(Math.min(15, avg * 0.5)) +
        "s (" +
        rushed.map((i) => "Q" + (i + 1)).join(", ") +
        "). These look rushed — slow down and re-read before marking.",
    ]);
  // time sinks
  const sinks = timeSpent
    .map((t, i) => (t > avg * 2 && t > 30 ? i : -1))
    .filter((i) => i >= 0);
  if (sinks.length)
    ins.push([
      "🕳",
      sinks.map((i) => "Q" + (i + 1)).join(", ") +
        " took over twice your average. In the real exam, park these and return at the end.",
    ]);
  // skipped time
  const skipTime = outcome.reduce(
    (a, o, i) => a + (o === "skipped" ? timeSpent[i] : 0),
    0,
  );
  if (skipped && skipTime > avg)
    ins.push([
      "⚠",
      "You spent " +
        fmtDur(skipTime) +
        " on questions you ultimately left blank. Deciding to skip faster frees that time for scoring questions.",
    ]);
  // pace vs budget
  const budgetPerQ = durationSec / n;
  if (usedSec < durationSec * 0.8 && (wrong > 0 || skipped > 0))
    ins.push([
      "🧭",
      "You finished with " +
        fmtDur(durationSec - usedSec) +
        " unused. With " +
        (wrong + skipped) +
        " questions not scored, that spare time could have gone into a second pass.",
    ]);
  else if (usedSec >= durationSec)
    ins.push([
      "🧭",
      "You ran the clock to zero. Your average was " +
        fmtDur(avg) +
        " against a budget of " +
        fmtDur(budgetPerQ) +
        " per question.",
    ]);
  // accuracy note
  const attempted = correct + wrong;
  if (attempted && correct / attempted >= 0.85 && skipped > n * 0.2)
    ins.push([
      "🎯",
      "Accuracy on attempts was high (" +
        Math.round((correct / attempted) * 100) +
        "%) but " +
        skipped +
        " were skipped — attempt-rate, not accuracy, is your bottleneck.",
    ]);

  $("insightList").innerHTML =
    ins
      .map(
        ([ic, t]) =>
          '<div class="insight"><span class="ic">' +
          ic +
          "</span><span>" +
          esc(t) +
          "</span></div>",
      )
      .join("") ||
    '<div class="insight"><span class="ic">✓</span><span>Clean run — nothing flagged.</span></div>';
}

function buildReview(outcome) {
  const body = $("reviewBody");
  body.innerHTML = "";
  const L = (i) => String.fromCharCode(65 + i);
  paper.forEach((q, i) => {
    const tr = document.createElement("tr");
    tr.className = "qrow";
    const your =
      answers[i] === null ? "—" : L(answers[i]) + ". " + q.options[answers[i]];
    tr.innerHTML =
      '<td class="tcell">Q' +
      esc(q.num) +
      "</td>" +
      "<td>" +
      esc(q.askedIn) +
      "</td>" +
      "<td>" +
      esc(your) +
      "</td>" +
      "<td>" +
      L(q.correct) +
      ". " +
      esc(q.options[q.correct]) +
      "</td>" +
      '<td class="tcell">' +
      fmtDur(timeSpent[i]) +
      "</td>" +
      '<td><span class="pill ' +
      outcome[i] +
      '">' +
      outcome[i].toUpperCase() +
      "</span></td>";
    const dr = document.createElement("tr");
    dr.className = "detail";
    dr.style.display = "none";
    dr.innerHTML =
      '<td colspan="6"><div class="dmeta">' +
      esc(q.askedIn) +
      "</div>" +
      esc(q.question) +
      '<div class="dopts">' +
      q.options
        .map((o, oi) => {
          let mark =
            oi === q.correct
              ? " ✓"
              : answers[i] === oi
                ? " ✗ (your answer)"
                : "";
          let col =
            oi === q.correct
              ? "var(--correct)"
              : answers[i] === oi
                ? "var(--wrong)"
                : "inherit";
          return (
            '<span style="color:' +
            col +
            '">' +
            L(oi) +
            ". " +
            esc(o) +
            mark +
            "</span>"
          );
        })
        .join("") +
      "</div></td>";
    tr.addEventListener("click", () => {
      dr.style.display = dr.style.display === "none" ? "" : "none";
    });
    body.appendChild(tr);
    body.appendChild(dr);
  });
}

$("retakeBtn").addEventListener("click", () => {
  startTest();
});
$("newPaperBtn").addEventListener("click", () => {
  show("setup");
});
