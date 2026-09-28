// Online Exam Application Logic for ว31281 การออกแบบและเทคโนโลยี 1
// โรงเรียนหอวัง ปทุมธานี

const STATE = {
  student: null,
  answers: {}, // { 1: 0, 2: 3, ..., 31: "text", 33: {input:"", output:""}, 35: {canvasData:"", text:""} }
  flagged: new Set(),
  activeTab: 'part1', // 'part1' | 'part2'
  timeRemaining: EXAM_CONFIG.timeLimitMinutes * 60, // in seconds
  timerInterval: null,
  isExamStarted: false,
  isExamSubmitted: false,
  drawingContexts: {}, // { 35: { canvas, ctx, isDrawing, history, tool, color, size }, 36: {...} }
  tabSwitchCount: 0
};

const STORAGE_KEY = 'hw_final_exam_v31281_state';
const SUBMISSIONS_KEY = 'hw_final_exam_v31281_submissions';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  renderQuestionNavGrid();
  renderPart1Questions();
  renderPart2Questions();
  setupEventListeners();
  checkSavedSession();
}

// ==========================================
// Session & State Persistence
// ==========================================
function checkSavedSession() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (data && data.student && !data.isExamSubmitted) {
        if (confirm(`พบข้อมูลการทำข้อสอบค้างอยู่ของ ${data.student.name} (ม.${data.student.gradeClass} เลขที่ ${data.student.seatNo})\nต้องการทำข้อสอบต่อจากเดิมหรือไม่?`)) {
          STATE.student = data.student;
          STATE.answers = data.answers || {};
          STATE.flagged = new Set(data.flagged || []);
          STATE.timeRemaining = data.timeRemaining || (EXAM_CONFIG.timeLimitMinutes * 60);
          STATE.tabSwitchCount = data.tabSwitchCount || 0;
          startExam(true);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }
  } catch (e) {
    console.error("Error loading session:", e);
  }
}

function saveStateToLocal() {
  if (!STATE.isExamStarted || STATE.isExamSubmitted) return;
  try {
    // Collect canvas image data for 35 & 36 only if drawing exists
    [35, 36].forEach(qid => {
      const canvas = document.getElementById(`canvas-q${qid}`);
      if (canvas && STATE.answers[qid] && STATE.answers[qid].hasDrawing) {
        STATE.answers[qid].canvasData = canvas.toDataURL('image/jpeg', 0.8);
      }
    });

    const dataToSave = {
      student: STATE.student,
      answers: STATE.answers,
      flagged: Array.from(STATE.flagged),
      timeRemaining: STATE.timeRemaining,
      tabSwitchCount: STATE.tabSwitchCount,
      isExamStarted: STATE.isExamStarted,
      isExamSubmitted: STATE.isExamSubmitted
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (e) {
    console.error("Error saving state:", e);
  }
}

// ==========================================
// Registration & Exam Launch
// ==========================================
function setupEventListeners() {
  const regForm = document.getElementById('registrationForm');
  if (regForm) {
    regForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('studentName').value.trim();
      const gradeClass = document.getElementById('studentClass').value;
      const seatNo = document.getElementById('studentSeatNo').value.trim();
      const studentId = document.getElementById('studentId').value.trim();
      const reason = document.getElementById('absenceReason').value;
      const agreement = document.getElementById('integrityAgreement').checked;

      if (!name || !gradeClass || !seatNo || !studentId) {
        alert('กรุณากรอกข้อมูลนักเรียนให้ครบถ้วนทุกช่อง');
        return;
      }

      if (!agreement) {
        alert('กรุณายอมรับข้อตกลงและยืนยันความซื่อสัตย์ในการสอบ');
        return;
      }

      STATE.student = {
        name,
        gradeClass,
        seatNo,
        studentId,
        reason,
        startTime: new Date().toISOString()
      };

      startExam(false);
    });
  }

  // Anti-cheat tab switch detector
  window.addEventListener('blur', () => {
    if (STATE.isExamStarted && !STATE.isExamSubmitted) {
      STATE.tabSwitchCount++;
      const banner = document.getElementById('cheatWarningBanner');
      if (banner) {
        banner.style.display = 'flex';
        banner.innerText = `⚠️ ตรวจพบการสลับหน้าต่าง/แท็บ (${STATE.tabSwitchCount} ครั้ง) ขอความกรุณาทำข้อสอบในหน้านี้อย่างซื่อสัตย์`;
      }
      saveStateToLocal();
    }
  });

  // Navigation tab switcher (Part 1 / Part 2)
  document.querySelectorAll('.section-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchSection(btn.dataset.section);
    });
  });
}

function startExam(isRestored = false) {
  STATE.isExamStarted = true;
  document.getElementById('screenWelcome').classList.remove('active');
  document.getElementById('screenExam').classList.add('active');

  // Show timer and student info in header
  const timerEl = document.getElementById('timerContainer');
  const headerNameEl = document.getElementById('headerStudentName');
  if (timerEl) timerEl.style.display = 'flex';
  if (headerNameEl) {
    headerNameEl.style.display = 'block';
    headerNameEl.textContent = `👤 ${STATE.student.name} (ม.${STATE.student.gradeClass} เลขที่ ${STATE.student.seatNo})`;
  }

  // Update sidebar student details
  document.getElementById('sidebarStudentName').textContent = STATE.student.name;
  document.getElementById('sidebarStudentClass').textContent = `ม.${STATE.student.gradeClass} | เลขที่ ${STATE.student.seatNo} | รหัส ${STATE.student.studentId}`;
  document.getElementById('sidebarStudentAvatar').textContent = STATE.student.name.charAt(0);

  // Restore existing answers in UI if restored
  if (isRestored) {
    restoreAnswersInUI();
  }

  initFlowchartCanvases();
  startTimer();
  updateProgressUI();
  saveStateToLocal();
}

// ==========================================
// Timer Engine
// ==========================================
function startTimer() {
  updateTimerDisplay();
  STATE.timerInterval = setInterval(() => {
    STATE.timeRemaining--;
    updateTimerDisplay();
    saveStateToLocal();

    if (STATE.timeRemaining <= 0) {
      clearInterval(STATE.timerInterval);
      alert('⏰ หมดเวลาการทำข้อสอบ 60 นาทีแล้ว ระบบจะส่งคำตอบของคุณโดยอัตโนมัติ');
      submitExam(true);
    }
  }, 1000);
}

function updateTimerDisplay() {
  const clockEl = document.getElementById('examClock');
  const timerContainer = document.getElementById('timerContainer');
  if (!clockEl || !timerContainer) return;

  const m = Math.floor(STATE.timeRemaining / 60);
  const s = STATE.timeRemaining % 60;
  const text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  clockEl.textContent = text;

  if (STATE.timeRemaining <= 300 && STATE.timeRemaining > 60) {
    timerContainer.className = 'timer-container timer-warning';
  } else if (STATE.timeRemaining <= 60) {
    timerContainer.className = 'timer-container timer-danger';
  } else {
    timerContainer.className = 'timer-container';
  }
}

// ==========================================
// Render Questions: Part 1 (Multiple Choice)
// ==========================================
function renderPart1Questions() {
  const container = document.getElementById('part1Container');
  if (!container) return;

  let html = '';
  QUESTIONS_PART_1.forEach((q) => {
    html += `
      <div class="question-card" id="qcard-${q.id}">
        <div class="question-header">
          <div class="q-number-title">
            <span class="q-badge">ข้อที่ ${q.id}</span>
            <span class="q-learning-outcome">${q.learningOutcome}</span>
          </div>
          <div class="q-actions">
            <button type="button" class="btn-flag" id="flagbtn-${q.id}" onclick="toggleFlag(${q.id})">
              🚩 <span>ปักหมุดทบทวน</span>
            </button>
          </div>
        </div>

        <div class="q-text">${formatQuestionText(q.questionText)}</div>

        ${renderQuestionDiagram(q)}

        <div class="options-list">
          ${q.options.map((opt, optIndex) => `
            <div class="option-item" id="opt-${q.id}-${optIndex}" onclick="selectOption(${q.id}, ${optIndex})">
              <div class="opt-radio-custom">${optIndex + 1}</div>
              <div class="opt-content">${opt}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function formatQuestionText(text) {
  // Render clean math formatting if LaTeX or special formatting is in text
  return text.replace(/\$\$(.*?)\$\$/g, '<span class="math-tex font-mono text-primary font-bold">$1</span>');
}

function renderQuestionDiagram(q) {
  if (q.id === 9) {
    return `
      <div class="diagram-container">
        <div style="font-weight: 600; margin-bottom: 12px; color: #1e3a8a;">ผังงานที่ต้องการใช้งาน: "A = B + C"</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; max-width: 600px; margin: 0 auto;">
          <div style="border: 1px dashed #94a3b8; padding: 10px; border-radius: 6px; background: #fff;">
            <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px;">ตัวเลือก 1</div>
            <svg width="110" height="42" viewBox="0 0 110 42">
              <rect x="5" y="5" width="100" height="32" rx="0" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>
              <text x="55" y="25" text-anchor="middle" font-size="12" font-family="sans-serif" font-weight="bold" fill="#1e3a8a">A = B + C</text>
            </svg>
          </div>
          <div style="border: 1px dashed #94a3b8; padding: 10px; border-radius: 6px; background: #fff;">
            <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px;">ตัวเลือก 2</div>
            <svg width="110" height="42" viewBox="0 0 110 42">
              <polygon points="55,5 105,21 55,37 5,21" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>
              <text x="55" y="24" text-anchor="middle" font-size="10" font-family="sans-serif" font-weight="bold" fill="#1e3a8a">A = B + C</text>
            </svg>
          </div>
          <div style="border: 1px dashed #94a3b8; padding: 10px; border-radius: 6px; background: #fff;">
            <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px;">ตัวเลือก 3</div>
            <svg width="110" height="42" viewBox="0 0 110 42">
              <polygon points="20,5 105,5 90,37 5,37" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>
              <text x="55" y="25" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="bold" fill="#1e3a8a">A = B + C</text>
            </svg>
          </div>
          <div style="border: 1px dashed #94a3b8; padding: 10px; border-radius: 6px; background: #fff;">
            <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px;">ตัวเลือก 4</div>
            <svg width="110" height="42" viewBox="0 0 110 42">
              <rect x="5" y="5" width="100" height="32" rx="16" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>
              <text x="55" y="25" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="bold" fill="#1e3a8a">A = B + C</text>
            </svg>
          </div>
        </div>
      </div>
    `;
  }

  if (q.id === 10) {
    return `
      <div class="math-formula-box">
        <span>สูตรคณิตศาสตร์:</span>
        <div class="fraction">
          <div class="numerator">x²</div>
          <div class="denominator">xy + 2</div>
        </div>
      </div>
    `;
  }

  if (q.id === 22) {
    return `
      <div class="math-formula-box">
        <span>นิพจน์:</span>
        <strong>2X² + Y</strong>
      </div>
    `;
  }

  if (q.id === 24) {
    return `
      <div class="diagram-container">
        <svg width="240" height="70" viewBox="0 0 240 70">
          <rect x="15" y="10" width="210" height="50" fill="#f0fdf4" stroke="#16a34a" stroke-width="2.5" rx="4"/>
          <text x="120" y="42" text-anchor="middle" font-size="19" font-family="'Fira Code', monospace" font-weight="bold" fill="#14532d">Y = A² / B</text>
        </svg>
      </div>
    `;
  }

  return '';
}

// ==========================================
// Render Questions: Part 2 (Written & Flowchart)
// ==========================================
function renderPart2Questions() {
  const container = document.getElementById('part2Container');
  if (!container) return;

  let html = '';
  QUESTIONS_PART_2.forEach((q) => {
    html += `
      <div class="question-card" id="qcard-${q.id}">
        <div class="question-header">
          <div class="q-number-title">
            <span class="q-badge" style="background: #fef3c7; color: #92400e;">${q.title}</span>
            <span class="q-learning-outcome">${q.learningOutcome}</span>
          </div>
          <div class="q-actions">
            <button type="button" class="btn-flag" id="flagbtn-${q.id}" onclick="toggleFlag(${q.id})">
              🚩 <span>ปักหมุดทบทวน</span>
            </button>
          </div>
        </div>

        <div class="q-text">${formatQuestionText(q.prompt)}</div>

        ${renderPart2FormulaBox(q)}

        ${renderPart2InputSection(q)}
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderPart2FormulaBox(q) {
  if (q.id === 32) {
    return `
      <div class="math-formula-box" style="justify-content: center; margin: 16px 0; font-size: 1.3rem;">
        <div class="fraction">
          <div class="numerator" style="border-bottom: 2.5px solid #1e3a8a; padding: 0 10px 4px 10px;">a + b</div>
          <div class="denominator" style="padding: 4px 10px 0 10px;">c × d</div>
        </div>
      </div>
    `;
  }

  if (q.id === 34) {
    return `
      <div class="math-formula-box" style="justify-content: center; margin: 16px 0; font-size: 1.3rem;">
        <span style="margin-right: 8px;">y = </span>
        <div class="fraction">
          <div class="numerator" style="border-bottom: 2.5px solid #1e3a8a; padding: 0 10px 4px 10px;">x³ + 5</div>
          <div class="denominator" style="padding: 4px 10px 0 10px;">2</div>
        </div>
      </div>
    `;
  }

  return '';
}

function renderPart2InputSection(q) {
  if (q.type === 'text_expression') {
    return `
      <div class="written-answer-box">
        <label style="display:block; font-size: 0.88rem; font-weight: 600; color: #475569; margin-bottom: 6px;">✍️ พิมพ์นิพจน์คำตอบของนักเรียน:</label>
        <input type="text" class="written-input" id="written-q${q.id}" placeholder="${q.placeholder}" oninput="handleWrittenInput(${q.id}, this.value)">
      </div>
    `;
  }

  if (q.type === 'dual_input') {
    return `
      <div class="written-answer-box">
        <div class="dual-input-grid">
          <div class="input-subfield">
            <label>📥 ข้อมูลเข้า (Input):</label>
            <input type="text" class="written-input" id="input-q${q.id}-in" placeholder="${q.fields[0].placeholder}" oninput="handleDualInput(${q.id})">
          </div>
          <div class="input-subfield">
            <label>📤 ข้อมูลออก (Output):</label>
            <input type="text" class="written-input" id="input-q${q.id}-out" placeholder="${q.fields[1].placeholder}" oninput="handleDualInput(${q.id})">
          </div>
        </div>
      </div>
    `;
  }

  if (q.type === 'image_upload' || q.type === 'flowchart_task') {
    return `
      <div class="flowchart-interactive-container">
        <div class="submission-mode-tabs">
          <button type="button" class="mode-tab-btn active" id="mode-upload-${q.id}" onclick="switchAnswerMode(${q.id}, 'upload')">
            📷 อัปโหลดรูปภาพ / ถ่ายภาพจากกระดาษ (แนะนำ)
          </button>
          <button type="button" class="mode-tab-btn" id="mode-draw-${q.id}" onclick="switchAnswerMode(${q.id}, 'draw')">
            ✏️ วาดผังงานบนหน้าจอ
          </button>
        </div>

        <!-- UPLOAD SECTION (PRIMARY) -->
        <div id="section-upload-${q.id}" class="upload-mode-panel">
          <div class="image-upload-zone" id="dropzone-${q.id}" 
               onclick="document.getElementById('fileinput-q${q.id}').click()"
               ondragover="handleDragOver(event, ${q.id})" 
               ondragleave="handleDragLeave(event, ${q.id})" 
               ondrop="handleFileDrop(event, ${q.id})">
            
            <div class="upload-icon-large">📷</div>
            <div class="upload-title">คลิกเพื่อเลือกไฟล์รูปภาพ หรือ ลากไฟล์มาวางที่นี่</div>
            <div class="upload-subtitle">รองรับไฟล์รูปถ่ายจากกระดาษ, JPG, PNG, HEIC (ขนาดไม่เกิน 15MB)</div>

            <div class="upload-actions-row" onclick="event.stopPropagation()">
              <input type="file" id="fileinput-q${q.id}" accept="image/*" style="display:none;" onchange="handleImageFileSelect(${q.id}, this)">
              <input type="file" id="camerainput-q${q.id}" accept="image/*" capture="environment" style="display:none;" onchange="handleImageFileSelect(${q.id}, this)">
              
              <button type="button" class="btn btn-primary btn-sm" onclick="document.getElementById('fileinput-q${q.id}').click()">
                📁 เลือกไฟล์รูปภาพ
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('camerainput-q${q.id}').click()">
                📸 ถ่ายภาพด้วยกล้อง
              </button>
            </div>
          </div>

          <!-- Uploaded Preview Container -->
          <div id="preview-box-${q.id}" class="uploaded-preview-card" style="display: none;">
            <div class="preview-image-container">
              <img id="preview-img-${q.id}" class="preview-image-element" src="" alt="ภาพผังงานของนักเรียน">
            </div>
            <div class="preview-meta-row">
              <span id="preview-filename-${q.id}" style="font-weight: 600; color: #1e3a8a;">✅ อัปโหลดรูปภาพสำเร็จ</span>
              <div style="display: flex; gap: 8px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('fileinput-q${q.id}').click()">
                  🔄 เปลี่ยนรูปภาพ
                </button>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeUploadedImage(${q.id})">
                  🗑️ ลบรูปภาพ
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- CANVAS DRAWING SECTION (FALLBACK OPTION) -->
        <div id="section-draw-${q.id}" class="draw-mode-panel" style="display: none;">
          <div class="flowchart-toolbar">
            <div class="canvas-tool-group">
              <button type="button" class="tool-btn active" id="tool-pen-${q.id}" onclick="setCanvasTool(${q.id}, 'pen')">✏️ ดินสอ</button>
              <button type="button" class="tool-btn" id="tool-line-${q.id}" onclick="setCanvasTool(${q.id}, 'line')">📏 เส้นตรง</button>
              <button type="button" class="tool-btn" id="tool-arrow-${q.id}" onclick="setCanvasTool(${q.id}, 'arrow')">➡️ ลูกศร</button>
              <button type="button" class="tool-btn" id="tool-eraser-${q.id}" onclick="setCanvasTool(${q.id}, 'eraser')">🧹 ยางลบ</button>
            </div>

            <div class="canvas-tool-group">
              <button type="button" class="tool-btn" onclick="addShapeToCanvas(${q.id}, 'terminal')">⭕ เริ่ม/จบ</button>
              <button type="button" class="tool-btn" onclick="addShapeToCanvas(${q.id}, 'io')">▰ รับ/แสดงผล</button>
              <button type="button" class="tool-btn" onclick="addShapeToCanvas(${q.id}, 'process')">▭ ประมวลผล</button>
              <button type="button" class="tool-btn" onclick="addShapeToCanvas(${q.id}, 'decision')">◇ เงื่อนไข</button>
            </div>

            <div class="canvas-tool-group">
              <button type="button" class="tool-btn" onclick="undoCanvas(${q.id})">↩️ ย้อนกลับ</button>
              <button type="button" class="tool-btn" style="color:#ef4444;" onclick="clearCanvas(${q.id})">🗑️ ล้างกระดาน</button>
            </div>
          </div>

          <div class="canvas-wrapper">
            <canvas id="canvas-q${q.id}" class="flowchart-canvas" width="800" height="420"></canvas>
          </div>
        </div>

        <div class="step-description-textarea" style="margin-top: 14px;">
          <label style="display:block; font-size: 0.88rem; font-weight: 600; color: #475569; margin-bottom: 6px;">📝 คำอธิบายขั้นตอน / อัลกอริทึมเพิ่มเติม (ถ้ามี):</label>
          <textarea class="form-textarea" style="width: 100%; height: 75px; font-size: 0.9rem;" id="textdesc-q${q.id}" placeholder="พิมพ์อธิบายขั้นตอนการทำงานเพิ่มเติม..." oninput="handleFlowchartText(${q.id}, this.value)"></textarea>
        </div>
      </div>
    `;
  }

  return '';
}

// ==========================================
// Question Navigator Grid
// ==========================================
function renderQuestionNavGrid() {
  const grid = document.getElementById('questionNavGrid');
  if (!grid) return;

  let html = '';
  for (let i = 1; i <= EXAM_CONFIG.totalQuestions; i++) {
    html += `
      <button type="button" class="nav-pill" id="navpill-${i}" onclick="jumpToQuestion(${i})">
        ${i}
      </button>
    `;
  }
  grid.innerHTML = html;
}

function updateProgressUI() {
  let answeredCount = 0;

  for (let i = 1; i <= EXAM_CONFIG.totalQuestions; i++) {
    const pill = document.getElementById(`navpill-${i}`);
    const card = document.getElementById(`qcard-${i}`);
    const flagBtn = document.getElementById(`flagbtn-${i}`);
    const isFlagged = STATE.flagged.has(i);

    let isAnswered = false;
    if (i <= 30) {
      isAnswered = STATE.answers[i] !== undefined;
    } else if (i === 31 || i === 32 || i === 34) {
      isAnswered = STATE.answers[i] && STATE.answers[i].trim().length > 0;
    } else if (i === 33) {
      isAnswered = STATE.answers[i] && (STATE.answers[i].input || STATE.answers[i].output);
    } else if (i === 35 || i === 36) {
      const a = STATE.answers[i];
      isAnswered = a && (a.uploadedImage || a.hasDrawing || (a.text && a.text.trim().length > 0));
    }

    if (isAnswered) answeredCount++;

    if (pill) {
      pill.className = 'nav-pill';
      if (isAnswered) pill.classList.add('answered');
      if (isFlagged) pill.classList.add('flagged');
    }

    if (card) {
      if (isFlagged) card.classList.add('flagged-card');
      else card.classList.remove('flagged-card');
    }

    if (flagBtn) {
      if (isFlagged) flagBtn.classList.add('active');
      else flagBtn.classList.remove('active');
    }
  }

  // Update progress bar
  const total = EXAM_CONFIG.totalQuestions;
  const pct = Math.round((answeredCount / total) * 100);
  document.getElementById('answeredCountLabel').textContent = `${answeredCount} / ${total} ข้อ`;
  document.getElementById('progressPercentLabel').textContent = `${pct}%`;
  document.getElementById('progressFillBar').style.width = `${pct}%`;
}

// ==========================================
// Image Upload Handlers (Q35 & Q36)
// ==========================================
function switchAnswerMode(qId, mode) {
  const uploadSec = document.getElementById(`section-upload-${qId}`);
  const drawSec = document.getElementById(`section-draw-${qId}`);
  const btnUpload = document.getElementById(`mode-upload-${qId}`);
  const btnDraw = document.getElementById(`mode-draw-${qId}`);

  if (mode === 'upload') {
    if (uploadSec) uploadSec.style.display = 'block';
    if (drawSec) drawSec.style.display = 'none';
    if (btnUpload) btnUpload.classList.add('active');
    if (btnDraw) btnDraw.classList.remove('active');
  } else {
    if (uploadSec) uploadSec.style.display = 'none';
    if (drawSec) drawSec.style.display = 'block';
    if (btnUpload) btnUpload.classList.remove('active');
    if (btnDraw) btnDraw.classList.add('active');
  }
}

function handleDragOver(e, qId) {
  e.preventDefault();
  const dropzone = document.getElementById(`dropzone-${qId}`);
  if (dropzone) dropzone.classList.add('dragover');
}

function handleDragLeave(e, qId) {
  e.preventDefault();
  const dropzone = document.getElementById(`dropzone-${qId}`);
  if (dropzone) dropzone.classList.remove('dragover');
}

function handleFileDrop(e, qId) {
  e.preventDefault();
  const dropzone = document.getElementById(`dropzone-${qId}`);
  if (dropzone) dropzone.classList.remove('dragover');

  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
    processImageFile(qId, e.dataTransfer.files[0]);
  }
}

function handleImageFileSelect(qId, inputEl) {
  if (inputEl.files && inputEl.files[0]) {
    processImageFile(qId, inputEl.files[0]);
  }
}

function processImageFile(qId, file) {
  if (!file.type.startsWith('image/')) {
    alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น (JPG, PNG, WebP)');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const rawData = e.target.result;
    compressImage(rawData, 1200, 0.82).then(compressedData => {
      if (!STATE.answers[qId]) STATE.answers[qId] = {};
      STATE.answers[qId].uploadedImage = compressedData;
      STATE.answers[qId].imageName = file.name;

      displayImagePreview(qId, compressedData, file.name);
      updateProgressUI();
      saveStateToLocal();
    }).catch(err => {
      console.error("Image compression error", err);
      if (!STATE.answers[qId]) STATE.answers[qId] = {};
      STATE.answers[qId].uploadedImage = rawData;
      displayImagePreview(qId, rawData, file.name);
      updateProgressUI();
      saveStateToLocal();
    });
  };
  reader.readAsDataURL(file);
}

function compressImage(base64Str, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = base64Str;
  });
}

function displayImagePreview(qId, dataUrl, filename) {
  const previewBox = document.getElementById(`preview-box-${qId}`);
  const previewImg = document.getElementById(`preview-img-${qId}`);
  const previewName = document.getElementById(`preview-filename-${qId}`);
  const dropzone = document.getElementById(`dropzone-${qId}`);

  if (previewImg) previewImg.src = dataUrl;
  if (previewName) previewName.textContent = `✅ ${filename || 'รูปภาพผังงานของนักเรียน'}`;
  if (previewBox) previewBox.style.display = 'flex';
  if (dropzone) dropzone.style.display = 'none';
}

function removeUploadedImage(qId) {
  if (!confirm('ต้องการลบรูปภาพที่อัปโหลดข้อนี้ใช่หรือไม่?')) return;
  if (STATE.answers[qId]) {
    delete STATE.answers[qId].uploadedImage;
    delete STATE.answers[qId].imageName;
  }
  const previewBox = document.getElementById(`preview-box-${qId}`);
  const dropzone = document.getElementById(`dropzone-${qId}`);
  const fileInput = document.getElementById(`fileinput-q${qId}`);
  const camInput = document.getElementById(`camerainput-q${qId}`);

  if (previewBox) previewBox.style.display = 'none';
  if (dropzone) dropzone.style.display = 'block';
  if (fileInput) fileInput.value = '';
  if (camInput) camInput.value = '';

  updateProgressUI();
  saveStateToLocal();
}

// ==========================================
// User Actions
// ==========================================
function selectOption(qId, optIndex) {
  STATE.answers[qId] = optIndex;

  // Clear previous selections for this question
  for (let i = 0; i < 4; i++) {
    const optEl = document.getElementById(`opt-${qId}-${i}`);
    if (optEl) optEl.classList.remove('selected');
  }

  const selectedEl = document.getElementById(`opt-${qId}-${optIndex}`);
  if (selectedEl) selectedEl.classList.add('selected');

  updateProgressUI();
  saveStateToLocal();
}

function handleWrittenInput(qId, value) {
  STATE.answers[qId] = value;
  updateProgressUI();
  saveStateToLocal();
}

function handleDualInput(qId) {
  const inVal = document.getElementById(`input-q${qId}-in`)?.value || '';
  const outVal = document.getElementById(`input-q${qId}-out`)?.value || '';
  STATE.answers[qId] = { input: inVal, output: outVal };
  updateProgressUI();
  saveStateToLocal();
}

function handleFlowchartText(qId, value) {
  if (!STATE.answers[qId]) STATE.answers[qId] = {};
  STATE.answers[qId].text = value;
  updateProgressUI();
  saveStateToLocal();
}

function toggleFlag(qId) {
  if (STATE.flagged.has(qId)) {
    STATE.flagged.delete(qId);
  } else {
    STATE.flagged.add(qId);
  }
  updateProgressUI();
  saveStateToLocal();
}

function toggleExamSection() {
  switchSection(STATE.activeTab === 'part1' ? 'part2' : 'part1');
}

function switchSection(section) {
  STATE.activeTab = section;
  document.querySelectorAll('.section-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  const p1 = document.getElementById('part1Container');
  const p2 = document.getElementById('part2Container');
  const btnToggle = document.getElementById('btnToggleSection');

  if (section === 'part1') {
    p1.style.display = 'block';
    p2.style.display = 'none';
    if (btnToggle) btnToggle.innerHTML = '🔄 สลับไปทำ ตอนที่ 2 (อัตนัย)';
  } else {
    p1.style.display = 'none';
    p2.style.display = 'block';
    if (btnToggle) btnToggle.innerHTML = '🔄 สลับไปทำ ตอนที่ 1 (ปรนัย)';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function jumpToQuestion(qId) {
  if (qId <= 30 && STATE.activeTab !== 'part1') {
    switchSection('part1');
  } else if (qId > 30 && STATE.activeTab !== 'part2') {
    switchSection('part2');
  }

  setTimeout(() => {
    const card = document.getElementById(`qcard-${qId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.transition = 'outline 0.3s';
      card.style.outline = '3px solid #2563eb';
      setTimeout(() => { card.style.outline = 'none'; }, 1500);
    }
  }, 50);
}

function restoreAnswersInUI() {
  // Part 1
  for (let i = 1; i <= 30; i++) {
    if (STATE.answers[i] !== undefined) {
      const el = document.getElementById(`opt-${i}-${STATE.answers[i]}`);
      if (el) el.classList.add('selected');
    }
  }
  // Part 2
  [31, 32, 34].forEach(id => {
    if (STATE.answers[id]) {
      const input = document.getElementById(`written-q${id}`);
      if (input) input.value = STATE.answers[id];
    }
  });
  if (STATE.answers[33]) {
    const inEl = document.getElementById(`input-q33-in`);
    const outEl = document.getElementById(`input-q33-out`);
    if (inEl && STATE.answers[33].input) inEl.value = STATE.answers[33].input;
    if (outEl && STATE.answers[33].output) outEl.value = STATE.answers[33].output;
  }
  [35, 36].forEach(id => {
    if (STATE.answers[id]) {
      if (STATE.answers[id].uploadedImage) {
        displayImagePreview(id, STATE.answers[id].uploadedImage, STATE.answers[id].imageName);
      }
      if (STATE.answers[id].text) {
        const txt = document.getElementById(`textdesc-q${id}`);
        if (txt) txt.value = STATE.answers[id].text;
      }
    }
  });
}

// ==========================================
// Interactive Canvas Engine (Q35 & Q36)
// ==========================================
function initFlowchartCanvases() {
  [35, 36].forEach(qId => {
    const canvas = document.getElementById(`canvas-q${qId}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const canvasState = {
      canvas,
      ctx,
      tool: 'pen',
      isDrawing: false,
      startX: 0,
      startY: 0,
      history: [canvas.toDataURL()]
    };

    STATE.drawingContexts[qId] = canvasState;

    // Canvas Events
    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      const pos = getPos(e);
      canvasState.isDrawing = true;
      canvasState.startX = pos.x;
      canvasState.startY = pos.y;

      if (canvasState.tool === 'pen' || canvasState.tool === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      }
    };

    const drawMove = (e) => {
      if (!canvasState.isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);

      if (canvasState.tool === 'pen') {
        ctx.strokeStyle = '#1e3a8a';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (canvasState.tool === 'eraser') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 20;
        ctx.lineCap = 'round';
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    };

    const endDraw = (e) => {
      if (!canvasState.isDrawing) return;
      canvasState.isDrawing = false;
      const pos = getPos(e.touches ? e.changedTouches[0] : e);

      if (canvasState.tool === 'line') {
        ctx.strokeStyle = '#1e3a8a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(canvasState.startX, canvasState.startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (canvasState.tool === 'arrow') {
        drawArrow(ctx, canvasState.startX, canvasState.startY, pos.x, pos.y);
      }

      saveCanvasSnapshot(qId);
      if (!STATE.answers[qId]) STATE.answers[qId] = {};
      STATE.answers[qId].hasDrawing = true;
      updateProgressUI();
      saveStateToLocal();
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', drawMove);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', () => { canvasState.isDrawing = false; });

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', drawMove, { passive: false });
    canvas.addEventListener('touchend', endDraw, { passive: false });

    // If state had saved drawing, restore it
    if (STATE.answers[qId] && STATE.answers[qId].canvasData) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        canvasState.history = [canvas.toDataURL()];
      };
      img.src = STATE.answers[qId].canvasData;
    }
  });
}

function setCanvasTool(qId, toolName) {
  const canvasState = STATE.drawingContexts[qId];
  if (!canvasState) return;
  canvasState.tool = toolName;

  ['pen', 'line', 'arrow', 'eraser'].forEach(t => {
    const btn = document.getElementById(`tool-${t}-${qId}`);
    if (btn) btn.classList.toggle('active', t === toolName);
  });
}

function drawArrow(ctx, fromx, fromy, tox, toy) {
  const headlen = 12;
  const dx = tox - fromx;
  const dy = toy - fromy;
  const angle = Math.atan2(dy, dx);
  ctx.strokeStyle = '#1e3a8a';
  ctx.fillStyle = '#1e3a8a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(fromx, fromy);
  ctx.lineTo(tox, toy);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function addShapeToCanvas(qId, shapeType) {
  const cs = STATE.drawingContexts[qId];
  if (!cs) return;
  const ctx = cs.ctx;

  // Stamp at center of canvas with offset
  const cx = 350 + (Math.random() * 80 - 40);
  const cy = 180 + (Math.random() * 80 - 40);

  ctx.fillStyle = '#eff6ff';
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 2.5;

  if (shapeType === 'terminal') {
    // Rounded oval
    drawRoundedRect(ctx, cx - 80, cy - 22, 160, 44, 22, true, true);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 14px Sarabun';
    ctx.textAlign = 'center';
    ctx.fillText('เริ่มต้น (Start)', cx, cy + 5);
  } else if (shapeType === 'process') {
    // Rectangle
    ctx.fillRect(cx - 80, cy - 25, 160, 50);
    ctx.strokeRect(cx - 80, cy - 25, 160, 50);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = '13px Sarabun';
    ctx.textAlign = 'center';
    ctx.fillText('คำนวณ / ประมวลผล', cx, cy + 4);
  } else if (shapeType === 'decision') {
    // Diamond
    ctx.beginPath();
    ctx.moveTo(cx, cy - 35);
    ctx.lineTo(cx + 80, cy);
    ctx.lineTo(cx, cy + 35);
    ctx.lineTo(cx - 80, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1e3a8a';
    ctx.font = '13px Sarabun';
    ctx.textAlign = 'center';
    ctx.fillText('เงื่อนไข ?', cx, cy + 4);
  } else if (shapeType === 'io') {
    // Parallelogram
    ctx.beginPath();
    ctx.moveTo(cx - 70, cy - 25);
    ctx.lineTo(cx + 80, cy - 25);
    ctx.lineTo(cx + 70, cy + 25);
    ctx.lineTo(cx - 80, cy + 25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1e3a8a';
    ctx.font = '13px Sarabun';
    ctx.textAlign = 'center';
    ctx.fillText('รับค่า / แสดงผล', cx, cy + 4);
  }

  saveCanvasSnapshot(qId);
  if (!STATE.answers[qId]) STATE.answers[qId] = {};
  STATE.answers[qId].hasDrawing = true;
  updateProgressUI();
  saveStateToLocal();
}

function stampTextOnCanvas(qId, text) {
  const cs = STATE.drawingContexts[qId];
  if (!cs) return;
  const ctx = cs.ctx;

  const yPos = 40 + (Math.random() * 280);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 14px Prompt, Sarabun';
  ctx.textAlign = 'left';
  ctx.fillText(text, 30, yPos);

  saveCanvasSnapshot(qId);
  if (!STATE.answers[qId]) STATE.answers[qId] = {};
  STATE.answers[qId].hasDrawing = true;
  updateProgressUI();
  saveStateToLocal();
}

function drawRoundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function saveCanvasSnapshot(qId) {
  const cs = STATE.drawingContexts[qId];
  if (!cs) return;
  cs.history.push(cs.canvas.toDataURL());
  if (cs.history.length > 20) cs.history.shift();
}

function undoCanvas(qId) {
  const cs = STATE.drawingContexts[qId];
  if (!cs || cs.history.length <= 1) return;
  cs.history.pop();
  const prev = cs.history[cs.history.length - 1];
  const img = new Image();
  img.onload = () => {
    cs.ctx.clearRect(0, 0, cs.canvas.width, cs.canvas.height);
    cs.ctx.drawImage(img, 0, 0);
  };
  img.src = prev;
}

function clearCanvas(qId) {
  if (!confirm('ต้องการล้างกระดานวาดผังงานข้อนี้ใช่หรือไม่?')) return;
  const cs = STATE.drawingContexts[qId];
  if (!cs) return;
  cs.ctx.fillStyle = '#ffffff';
  cs.ctx.fillRect(0, 0, cs.canvas.width, cs.canvas.height);
  cs.history = [cs.canvas.toDataURL()];
  if (STATE.answers[qId]) {
    STATE.answers[qId].canvasData = null;
    STATE.answers[qId].hasDrawing = false;
  }
  updateProgressUI();
  saveStateToLocal();
}

// ==========================================
// Submission & Auto Evaluation
// ==========================================
function confirmSubmit() {
  let unanswered = 0;
  for (let i = 1; i <= EXAM_CONFIG.totalQuestions; i++) {
    let done = false;
    if (i <= 30) done = STATE.answers[i] !== undefined;
    else if (i === 31 || i === 32 || i === 34) done = STATE.answers[i] && STATE.answers[i].trim().length > 0;
    else if (i === 33) done = STATE.answers[i] && (STATE.answers[i].input || STATE.answers[i].output);
    else if (i === 35 || i === 36) {
      const a = STATE.answers[i];
      done = a && (a.uploadedImage || a.hasDrawing || (a.text && a.text.trim().length > 0));
    }
    if (!done) unanswered++;
  }

  const modal = document.getElementById('submitConfirmModal');
  const detailsEl = document.getElementById('unansweredDetailsText');

  if (unanswered > 0) {
    detailsEl.innerHTML = `<strong style="color:#ef4444;">⚠️ คุณยังมีข้อสอบที่ยังไม่ได้ตอบอีก ${unanswered} ข้อ</strong><br>ต้องการยืนยันที่จะส่งข้อสอบเลยหรือไม่?`;
  } else {
    detailsEl.innerHTML = `<strong style="color:#10b981;">🎉 คุณตอบข้อสอบครบทั้ง 36 ข้อแล้ว!</strong><br>พร้อมส่งคำตอบเพื่อประมวลผลคะแนนแล้ว`;
  }

  modal.classList.add('active');
}

function closeSubmitModal() {
  document.getElementById('submitConfirmModal').classList.remove('active');
}

function submitExam(isAuto = false) {
  closeSubmitModal();
  if (STATE.timerInterval) clearInterval(STATE.timerInterval);
  STATE.isExamSubmitted = true;

  // Auto Evaluate Part 1
  let part1Correct = 0;
  QUESTIONS_PART_1.forEach(q => {
    if (STATE.answers[q.id] === q.correctAnswer) {
      part1Correct++;
    }
  });

  // Calculate Part 1 Score (out of 10 points)
  const part1CalculatedScore = Number(((part1Correct / 30) * 10).toFixed(2));

  // Evaluate Part 2 (Provisional Auto-grading)
  let part2Provisional = 0;

  // Q31 (1 pt)
  const ans31 = (STATE.answers[31] || '').toLowerCase().replace(/\s+/g, '');
  if (ans31.includes('score>=50') && (ans31.includes('score<80') || ans31.includes('80>score')) && (ans31.includes('&&') || ans31.includes('and'))) {
    part2Provisional += 1;
  }

  // Q32 (1 pt)
  const ans32 = (STATE.answers[32] || '').toLowerCase().replace(/\s+/g, '');
  if (ans32.includes('(a+b)') && (ans32.includes('(c*d)') || ans32.includes('(cxd)') || ans32.includes('/c/d'))) {
    part2Provisional += 1;
  }

  // Q33 (2 pts)
  const ans33 = STATE.answers[33] || {};
  let q33Score = 0;
  const inStr = (ans33.input || '').toLowerCase();
  const outStr = (ans33.output || '').toLowerCase();
  if (inStr.includes('ฐาน') || inStr.includes('สูง') || inStr.includes('base') || inStr.includes('height')) q33Score += 1;
  if (outStr.includes('พื้นที่') || outStr.includes('สามเหลี่ยม') || outStr.includes('area')) q33Score += 1;
  part2Provisional += q33Score;

  // Q34 (1 pt)
  const ans34 = (STATE.answers[34] || '').toLowerCase().replace(/\s+/g, '');
  if ((ans34.includes('x*x*x') || ans34.includes('pow(x,3)') || ans34.includes('x**3')) && ans34.includes('+5') && ans34.includes('/2')) {
    part2Provisional += 1;
  }

  // Q35 & Q36 Flowchart tasks (2.5 pts each provisional if photo uploaded, drawings or steps present)
  let q35Score = (STATE.answers[35]?.uploadedImage || STATE.answers[35]?.hasDrawing || STATE.answers[35]?.text) ? 2.5 : 0;
  let q36Score = (STATE.answers[36]?.uploadedImage || STATE.answers[36]?.hasDrawing || STATE.answers[36]?.text) ? 2.5 : 0;
  part2Provisional += (q35Score + q36Score);

  const totalCalculated = Number((part1CalculatedScore + part2Provisional).toFixed(2));

  const submissionRecord = {
    id: 'SUB-' + Date.now(),
    student: STATE.student,
    answers: STATE.answers,
    part1Correct,
    part1Score: part1CalculatedScore,
    part2ProvisionalScore: part2Provisional,
    totalScore: totalCalculated,
    tabSwitchCount: STATE.tabSwitchCount,
    submittedAt: new Date().toLocaleString('th-TH'),
    submissionType: isAuto ? 'หมดเวลาอัตโนมัติ' : 'นักเรียนกดยืนยันส่ง'
  };

  // Save to all submissions history
  saveSubmissionRecord(submissionRecord);
  localStorage.removeItem(STORAGE_KEY);

  // Show Result Screen
  showResultScreen(submissionRecord);
}

function saveSubmissionRecord(record) {
  try {
    const list = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
    list.push(record);
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Failed to save submission history", e);
  }
}

// ==========================================
// Result Screen & Solution Review
// ==========================================
function showResultScreen(record) {
  document.getElementById('screenExam').classList.remove('active');
  document.getElementById('screenResult').classList.add('active');

  // Fill Header
  document.getElementById('resStudentName').textContent = record.student.name;
  document.getElementById('resStudentMeta').textContent = `ม.${record.student.gradeClass} เลขที่ ${record.student.seatNo} (รหัสประจำตัว: ${record.student.studentId})`;
  document.getElementById('resSubmitTime').textContent = `ส่งเมื่อ: ${record.submittedAt} (${record.submissionType})`;

  // Fill Scores
  document.getElementById('resTotalScoreLarge').textContent = record.totalScore;
  document.getElementById('resPart1Score').textContent = `${record.part1Score} / 10 คะแนน (${record.part1Correct}/30 ข้อ)`;
  document.getElementById('resPart2Score').textContent = `${record.part2ProvisionalScore} / 10 คะแนน (รอครูตรวจยืนยัน)`;

  // Render Part 1 Solutions Review
  renderPart1Review();
  renderPart2Review();
}

function renderPart1Review() {
  const container = document.getElementById('reviewPart1List');
  if (!container) return;

  let html = '';
  QUESTIONS_PART_1.forEach((q) => {
    const studentAns = STATE.answers[q.id];
    const isCorrect = studentAns === q.correctAnswer;
    const answeredText = studentAns !== undefined ? `${studentAns + 1}. ${q.options[studentAns]}` : '<em style="color:#ef4444;">ไม่ได้ตอบ</em>';
    const correctText = `${q.correctAnswer + 1}. ${q.options[q.correctAnswer]}`;

    html += `
      <div class="review-item">
        <div class="review-header ${isCorrect ? 'correct' : 'incorrect'}">
          <div>
            <strong>ข้อที่ ${q.id}:</strong> ${q.questionText}
          </div>
          <div>
            ${isCorrect ? '<span style="color:#059669; font-weight:700;">✅ ถูกต้อง (+0.33)</span>' : '<span style="color:#dc2626; font-weight:700;">❌ ไม่ถูกต้อง (0)</span>'}
          </div>
        </div>
        <div class="review-body">
          <div style="margin-bottom: 6px;"><strong>คำตอบของคุณ:</strong> ${answeredText}</div>
          <div style="margin-bottom: 6px; color:#1e40af;"><strong>เฉลยที่ถูกต้อง:</strong> ${correctText}</div>
          <div style="background:#f8fafc; padding:8px 12px; border-radius:6px; font-size:0.84rem; color:#475569;">
            💡 <strong>คำอธิบาย:</strong> ${q.explanation}
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderPart2Review() {
  const container = document.getElementById('reviewPart2List');
  if (!container) return;

  let html = '';
  QUESTIONS_PART_2.forEach((q) => {
    let studentAnsHtml = '';
    if (q.type === 'text_expression') {
      studentAnsHtml = `<strong>คำตอบที่พิมพ์:</strong> <code>${STATE.answers[q.id] || '(ไม่ได้ระบุ)'}</code>`;
    } else if (q.type === 'dual_input') {
      const a = STATE.answers[q.id] || {};
      studentAnsHtml = `<strong>Input:</strong> ${a.input || '-'} | <strong>Output:</strong> ${a.output || '-'}`;
    } else if (q.type === 'image_upload' || q.type === 'flowchart_task') {
      const a = STATE.answers[q.id] || {};
      let imgSection = '<span style="color:#ef4444;">ไม่มีรูปภาพที่ส่ง</span>';
      if (a.uploadedImage) {
        imgSection = `
          <div style="margin: 8px 0;">
            <strong style="color:#059669;">📷 รูปภาพที่นักเรียนอัปโหลดส่ง:</strong><br>
            <a href="${a.uploadedImage}" target="_blank" title="คลิกเพื่อดูรูปภาพขนาดเต็ม">
              <img src="${a.uploadedImage}" style="max-width: 320px; max-height: 200px; border-radius: 6px; border: 1.5px solid #cbd5e1; margin-top: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
            </a>
            <div style="font-size: 0.75rem; color: #64748b;">(คลิกที่รูปภาพเพื่อเปิดดูรูปเต็ม)</div>
          </div>
        `;
      } else if (a.hasDrawing) {
        imgSection = `<strong style="color:#2563eb;">🎨 วาดผังงานบนหน้าจอ</strong>`;
      }

      studentAnsHtml = `
        <div>${imgSection}</div>
        <div style="margin-top: 6px;"><strong>คำอธิบายขั้นตอน:</strong> ${a.text || '(ไม่มีข้อความ)'}</div>
      `;
    }

    html += `
      <div class="review-item">
        <div class="review-header correct">
          <div><strong>${q.title}:</strong> ${q.prompt}</div>
          <span style="color:#b45309; font-weight:600;">คะแนนเต็ม: ${q.points} คะแนน</span>
        </div>
        <div class="review-body">
          <div style="margin-bottom: 8px;">${studentAnsHtml}</div>
          <div style="background:#eff6ff; padding:8px 12px; border-radius:6px; font-size:0.84rem; color:#1e3a8a;">
            💡 <strong>แนวทางคำตอบที่ถูกต้อง:</strong> ${q.guidance}
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function switchResultTab(tabName) {
  document.querySelectorAll('.result-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  const t1 = document.getElementById('resultTabPart1');
  const t2 = document.getElementById('resultTabPart2');
  const tAdmin = document.getElementById('resultTabAdmin');

  if (t1) t1.style.display = tabName === 'part1' ? 'block' : 'none';
  if (t2) t2.style.display = tabName === 'part2' ? 'block' : 'none';
  if (tAdmin) {
    tAdmin.style.display = tabName === 'admin' ? 'block' : 'none';
    if (tabName === 'admin') renderTeacherDashboard();
  }
}

// ==========================================
// Teacher Management Portal & Individual Paper Grading
// ==========================================
let currentInspectingSubId = null;

function openTeacherPortal() {
  document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
  document.getElementById('screenTeacher').classList.add('active');
  refreshTeacherDashboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function returnToMainScreen() {
  document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
  if (STATE.isExamSubmitted) {
    document.getElementById('screenResult').classList.add('active');
  } else if (STATE.isExamStarted) {
    document.getElementById('screenExam').classList.add('active');
  } else {
    document.getElementById('screenWelcome').classList.add('active');
  }
}

function refreshTeacherDashboard() {
  const list = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
  
  // Update Stats
  const count = list.length;
  document.getElementById('statTotalStudents').textContent = `${count} คน`;

  if (count > 0) {
    const scores = list.map(r => Number(r.totalScore) || 0);
    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = (sum / count).toFixed(2);
    const max = Math.max(...scores);
    const min = Math.min(...scores);

    document.getElementById('statAvgScore').textContent = `${avg} / 20`;
    document.getElementById('statMaxScore').textContent = `${max} / 20`;
    document.getElementById('statMinScore').textContent = `${min} / 20`;
  } else {
    document.getElementById('statAvgScore').textContent = `0 / 20`;
    document.getElementById('statMaxScore').textContent = `0`;
    document.getElementById('statMinScore').textContent = `0`;
  }

  filterTeacherSubmissions();
}

function filterTeacherSubmissions() {
  const list = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
  const classFilter = document.getElementById('teacherClassFilter')?.value || 'ALL';
  const keyword = (document.getElementById('teacherSearchInput')?.value || '').toLowerCase().trim();

  const filtered = list.filter(r => {
    const matchClass = (classFilter === 'ALL') || (r.student.gradeClass === classFilter);
    const matchKey = !keyword || 
                     r.student.name.toLowerCase().includes(keyword) || 
                     (r.student.studentId && r.student.studentId.includes(keyword)) ||
                     (r.student.seatNo && r.student.seatNo.toString() === keyword);
    return matchClass && matchKey;
  });

  renderTeacherTable(filtered);
}

function renderTeacherTable(list) {
  const container = document.getElementById('teacherTableContainer');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #64748b; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
        <div style="font-size: 2.5rem; margin-bottom: 8px;">📭</div>
        <p style="font-weight: 600; font-size: 1rem;">ยังไม่พบข้อมูลการส่งข้อสอบตามเงื่อนไขที่เลือก</p>
        <p style="font-size: 0.85rem; color: #94a3b8;">เมื่อนักเรียนกดส่งข้อสอบ รายชื่อและคะแนนจะปรากฏที่นี่ทันที</p>
      </div>
    `;
    return;
  }

  let html = `
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width: 50px;">ที่</th>
          <th>ชื่อ - นามสกุล</th>
          <th style="width: 70px;">ห้อง</th>
          <th style="width: 60px;">เลขที่</th>
          <th style="width: 90px;">รหัส นร.</th>
          <th style="width: 110px;">ตอนที่ 1 (ปรนัย)</th>
          <th style="width: 110px;">ตอนที่ 2 (อัตนัย)</th>
          <th style="width: 100px;">คะแนนรวม</th>
          <th style="width: 150px;">เวลาส่ง</th>
          <th style="width: 160px; text-align: center;">จัดการ / ตรวจข้อสอบ</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((r, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>
              <strong>${r.student.name}</strong>
              ${r.tabSwitchCount > 0 ? `<span style="display:inline-block; font-size:0.72rem; background:#fee2e2; color:#b91c1c; padding:1px 6px; border-radius:10px; margin-left:4px;">สลับจอ ${r.tabSwitchCount} ครั้ง</span>` : ''}
            </td>
            <td>ม.${r.student.gradeClass}</td>
            <td>${r.student.seatNo}</td>
            <td>${r.student.studentId}</td>
            <td><span style="color:#2563eb; font-weight:700;">${r.part1Score}</span> / 10</td>
            <td><span style="color:#059669; font-weight:700;">${r.part2ProvisionalScore}</span> / 10</td>
            <td><strong style="color:#d97706; font-size:1.1rem;">${r.totalScore}</strong> / 20</td>
            <td><small style="color:#64748b;">${r.submittedAt}</small></td>
            <td style="text-align: center;">
              <button type="button" class="btn btn-primary btn-sm" onclick="inspectStudentPaper('${r.id}')" style="padding: 4px 10px; font-size: 0.8rem;">
                👁️ ตรวจกระดาษคำตอบ
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

// ==========================================
// Inspect & Grade Individual Student Paper
// ==========================================
function inspectStudentPaper(subId) {
  const list = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
  const record = list.find(r => r.id === subId);
  if (!record) {
    alert('ไม่พบข้อมูลกระดาษคำตอบชุดนี้');
    return;
  }

  currentInspectingSubId = subId;
  const modal = document.getElementById('studentPaperModal');
  document.getElementById('modalStudentPaperTitle').textContent = `กระดาษคำตอบ: ${record.student.name}`;
  document.getElementById('modalStudentPaperMeta').textContent = `ม.${record.student.gradeClass} เลขที่ ${record.student.seatNo} | รหัสประจำตัว: ${record.student.studentId} | ส่งเมื่อ: ${record.submittedAt}`;

  let contentHtml = `
    <!-- Summary Header of Student -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center;">
      <div>
        <div style="font-size: 0.8rem; color: #64748b;">ตอนที่ 1 (ปรนัย 30 ข้อ)</div>
        <strong style="font-size: 1.25rem; color: #2563eb;">${record.part1Score} / 10</strong>
      </div>
      <div>
        <div style="font-size: 0.8rem; color: #64748b;">ตอนที่ 2 (อัตนัย 6 ข้อ)</div>
        <strong id="modalPart2LiveScore" style="font-size: 1.25rem; color: #059669;">${record.part2ProvisionalScore} / 10</strong>
      </div>
      <div>
        <div style="font-size: 0.8rem; color: #64748b;">คะแนนรวมสุทธิ</div>
        <strong id="modalTotalLiveScore" style="font-size: 1.35rem; color: #d97706;">${record.totalScore} / 20</strong>
      </div>
    </div>

    <!-- Tab 2: PART 2 ATTANAI (MAIN FOCUS FOR TEACHER GRADING) -->
    <h4 style="font-size: 1.05rem; color: #1e3a8a; margin: 18px 0 10px 0; border-bottom: 2px solid #93c5fd; padding-bottom: 4px;">
      ✍️ ตรวจให้คะแนน ตอนที่ 2 (อัตนัย 6 ข้อ - เต็ม 10 คะแนน)
    </h4>
  `;

  // Render Part 2 Questions for Grading
  QUESTIONS_PART_2.forEach(q => {
    const a = record.answers[q.id];
    let answerDisplayHtml = '';
    let currentScore = 0;

    if (q.id === 31 || q.id === 32 || q.id === 34) {
      answerDisplayHtml = `<div style="background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; font-family: monospace; font-size: 1rem; color: #1e293b; margin: 6px 0;">${a || '<em style="color:#ef4444;">(ไม่ได้ตอบ)</em>'}</div>`;
      // Default score if already calculated or auto-check
      if (q.id === 31) {
        const s = (a || '').toLowerCase().replace(/\s+/g, '');
        if (s.includes('score>=50') && (s.includes('score<80') || s.includes('80>score')) && (s.includes('&&') || s.includes('and'))) currentScore = 1;
      } else if (q.id === 32) {
        const s = (a || '').toLowerCase().replace(/\s+/g, '');
        if (s.includes('(a+b)') && (s.includes('(c*d)') || s.includes('(cxd)') || s.includes('/c/d'))) currentScore = 1;
      } else if (q.id === 34) {
        const s = (a || '').toLowerCase().replace(/\s+/g, '');
        if ((s.includes('x*x*x') || s.includes('pow(x,3)') || s.includes('x**3')) && s.includes('+5') && s.includes('/2')) currentScore = 1;
      }
    } else if (q.id === 33) {
      const dual = a || {};
      answerDisplayHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0;">
          <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; font-size: 0.88rem;">
            <strong>📥 Input:</strong> ${dual.input || '<em style="color:#ef4444;">-</em>'}
          </div>
          <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; font-size: 0.88rem;">
            <strong>📤 Output:</strong> ${dual.output || '<em style="color:#ef4444;">-</em>'}
          </div>
        </div>
      `;
      const inStr = (dual.input || '').toLowerCase();
      const outStr = (dual.output || '').toLowerCase();
      if (inStr.includes('ฐาน') || inStr.includes('สูง') || inStr.includes('base') || inStr.includes('height')) currentScore += 1;
      if (outStr.includes('พื้นที่') || outStr.includes('สามเหลี่ยม') || outStr.includes('area')) currentScore += 1;
    } else if (q.id === 35 || q.id === 36) {
      const flow = a || {};
      let imgHtml = '<div style="color:#ef4444; margin: 6px 0; font-size:0.88rem;">❌ ไม่ได้อัปโหลดรูปภาพ</div>';
      if (flow.uploadedImage) {
        imgHtml = `
          <div style="margin: 10px 0;">
            <div style="font-weight: 600; color: #059669; font-size: 0.85rem; margin-bottom: 4px;">📷 รูปภาพที่นักเรียนอัปโหลดส่ง (คลิกเพื่อเปิดดูรูปขนาดเต็ม):</div>
            <a href="${flow.uploadedImage}" target="_blank">
              <img src="${flow.uploadedImage}" style="max-width: 100%; max-height: 380px; object-fit: contain; border-radius: 6px; border: 2px solid #059669; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: block;">
            </a>
          </div>
        `;
      } else if (flow.hasDrawing && flow.canvasData) {
        imgHtml = `
          <div style="margin: 10px 0;">
            <div style="font-weight: 600; color: #2563eb; font-size: 0.85rem; margin-bottom: 4px;">🎨 ภาพวาดบนกระดานดิจิทัล:</div>
            <img src="${flow.canvasData}" style="max-width: 100%; max-height: 300px; border-radius: 6px; border: 1.5px solid #cbd5e1; display: block;">
          </div>
        `;
      }

      answerDisplayHtml = `
        ${imgHtml}
        <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; font-size: 0.85rem; margin-top: 6px;">
          <strong>📝 คำอธิบายขั้นตอน:</strong> ${flow.text || '<em style="color:#94a3b8;">(ไม่มีข้อความเพิ่มเติม)</em>'}
        </div>
      `;
      currentScore = (flow.uploadedImage || flow.hasDrawing || flow.text) ? q.points : 0;
    }

    // Override with existing graded score if already modified before
    if (record.customGrading && record.customGrading[q.id] !== undefined) {
      currentScore = record.customGrading[q.id];
    }

    contentHtml += `
      <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
          <div style="font-weight: 600; color: #1e293b; font-size: 0.95rem;">
            ${q.title}: <span style="font-weight: 400; color: #334155;">${q.prompt}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; background: #ffffff; border: 1.5px solid #93c5fd; padding: 4px 10px; border-radius: 6px; flex-shrink: 0;">
            <label style="font-size: 0.82rem; font-weight: 600; color: #1e3a8a;">คะแนนที่ได้:</label>
            <input type="number" id="gradeInput-q${q.id}" class="form-input" style="width: 70px; padding: 4px 6px; text-align: center; font-weight: 700; color: #059669;" 
                   value="${currentScore}" min="0" max="${q.points}" step="0.25" oninput="recalcModalLiveScore(${record.part1Score})">
            <span style="font-size: 0.82rem; color: #64748b;">/ ${q.points}</span>
          </div>
        </div>

        ${answerDisplayHtml}

        <div style="font-size: 0.78rem; color: #1e3a8a; background: #eff6ff; padding: 6px 10px; border-radius: 4px; margin-top: 6px;">
          💡 <strong>แนวทางคำตอบ:</strong> ${q.guidance}
        </div>
      </div>
    `;
  });

  // Render Part 1 Question summary accordions
  contentHtml += `
    <details style="margin-top: 20px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
      <summary style="padding: 12px 16px; background: #f1f5f9; font-weight: 600; font-family: 'Prompt', sans-serif; cursor: pointer; color: #1e3a8a;">
        🔘 ดูรายละเอียดคำตอบ ตอนที่ 1 (ปรนัย 30 ข้อ) [คลิกเพื่อเปิด/ปิด]
      </summary>
      <div style="padding: 16px; background: #ffffff; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px;">
        ${QUESTIONS_PART_1.map(q => {
          const ans = record.answers[q.id];
          const isRight = ans === q.correctAnswer;
          return `
            <div style="padding: 6px 10px; border-radius: 6px; border: 1px solid ${isRight ? '#bbf7d0' : '#fecaca'}; background: ${isRight ? '#f0fdf4' : '#fef2f2'}; font-size: 0.82rem; display: flex; justify-content: space-between; align-items: center;">
              <span><strong>ข้อ ${q.id}:</strong> เลือกข้อ ${ans !== undefined ? ans + 1 : '-'}</span>
              <span>${isRight ? '✅ ถูก (ข้อ ' + (q.correctAnswer + 1) + ')' : '❌ ผิด (เฉลย ' + (q.correctAnswer + 1) + ')'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </details>
  `;

  document.getElementById('studentPaperContent').innerHTML = contentHtml;
  modal.classList.add('active');
}

function recalcModalLiveScore(part1Score) {
  let part2Total = 0;
  QUESTIONS_PART_2.forEach(q => {
    const val = parseFloat(document.getElementById(`gradeInput-q${q.id}`)?.value) || 0;
    part2Total += val;
  });

  part2Total = Number(part2Total.toFixed(2));
  const total = Number((part1Score + part2Total).toFixed(2));

  document.getElementById('modalPart2LiveScore').textContent = `${part2Total} / 10`;
  document.getElementById('modalTotalLiveScore').textContent = `${total} / 20`;
}

function saveTeacherGradingFromModal() {
  if (!currentInspectingSubId) return;

  const list = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
  const recordIndex = list.findIndex(r => r.id === currentInspectingSubId);
  if (recordIndex === -1) return;

  const record = list[recordIndex];
  const customGrading = {};
  let part2Total = 0;

  QUESTIONS_PART_2.forEach(q => {
    const val = parseFloat(document.getElementById(`gradeInput-q${q.id}`)?.value) || 0;
    customGrading[q.id] = val;
    part2Total += val;
  });

  part2Total = Number(part2Total.toFixed(2));
  record.customGrading = customGrading;
  record.part2ProvisionalScore = part2Total;
  record.totalScore = Number((record.part1Score + part2Total).toFixed(2));

  list[recordIndex] = record;
  localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(list));

  alert(`✅ บันทึกคะแนนของ ${record.student.name} เรียบร้อยแล้ว (รวมสุทธิ: ${record.totalScore} / 20 คะแนน)`);
  closeStudentPaperModal();
  refreshTeacherDashboard();
}

function closeStudentPaperModal() {
  document.getElementById('studentPaperModal').classList.remove('active');
  currentInspectingSubId = null;
}

// ==========================================
// Backup & Export JSON / Import JSON
// ==========================================
function exportSubmissionsJSON() {
  const list = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
  if (list.length === 0) {
    alert('ไม่มีข้อมูลสำหรับสำรอง');
    return;
  }

  const jsonStr = JSON.stringify(list, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `สำรองข้อมูลข้อสอบ_ว31281_หอวังปทุมธานี_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importSubmissionsJSON(inputEl) {
  if (!inputEl.files || !inputEl.files[0]) return;
  const file = inputEl.files[0];
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const importedList = JSON.parse(e.target.result);
      if (!Array.isArray(importedList)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');

      const existingList = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
      const existingIds = new Set(existingList.map(r => r.id));
      let added = 0;

      importedList.forEach(item => {
        if (item.id && !existingIds.has(item.id)) {
          existingList.push(item);
          added++;
        }
      });

      localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(existingList));
      alert(`นำเข้าข้อมูลสำเร็จ! เพิ่มข้อมูลนักเรียนใหม่ ${added} คน`);
      refreshTeacherDashboard();
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการนำเข้าไฟล์ JSON กรุณาตรวจสอบความถูกต้องของไฟล์');
    }
  };
  reader.readAsText(file);
}

function exportSubmissionsCSV() {
  const list = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
  if (list.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }

  let csvContent = "\uFEFFลำดับ,ชื่อ-นามสกุล,ห้อง,เลขที่,รหัสนักเรียน,คะแนนตอนที่1,คะแนนตอนที่2,คะแนนรวม,สลับจอ(ครั้ง),สาเหตุการสอบตกค้าง,เวลาส่ง\n";
  list.forEach((r, idx) => {
    csvContent += `"${idx + 1}","${r.student.name}","ม.${r.student.gradeClass}","${r.student.seatNo}","${r.student.studentId}","${r.part1Score}","${r.part2ProvisionalScore}","${r.totalScore}","${r.tabSwitchCount || 0}","${r.student.reason || 'ฝนตกหนัก'}","${r.submittedAt}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ผลการสอบปลายภาค_ว31281_หอวังปทุมธานี_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function printExamReport() {
  window.print();
}
