const firebaseConfig = {
    apiKey: "AIzaSyDMf60VU5lzUOU5t9MR8IX4y1wEvW0cQO8",
    authDomain: "gas-shimal-app.firebaseapp.com",
    databaseURL: "https://gas-shimal-app-default-rtdb.firebaseio.com",
    projectId: "gas-shimal-app",
    storageBucket: "gas-shimal-app.firebasestorage.app",
    messagingSenderId: "28578527188",
    appId: "1:28578527188:web:0200b193d18c3dabe50841",
    measurementId: "G-P6872T8448"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const FOUNDER_EMAIL = "Musqaqa009@gmail.com";
const GTU_HEAD_ROLE = "مسؤول شعبة GTU";
const SHIFT_ANCHOR_DATE_KEY = "2026-11-22";

const WORKSITE_LAT = 30.569143;
const WORKSITE_LNG = 47.324365;
const WORKSITE_RADIUS_METERS = 800;

const RESPONSIBILITY_ROLES = [
    "مسؤول شعبة GTU",
    "مسؤول وحدة الإنتاج",
    "مهندس نوبة",
    "مسؤول نوبة"
];

const BOX_KEYS = ["dateShift", "readings", "equipment", "results", "notes"];

const HOUR_ROW_PALETTE = [
    { bg: "#f1f5f9", timeBg: "#e2e8f0", flowColor: "#0f172a" }, // رصاصي فاتح
    { bg: "#ffffff", timeBg: "#f8fafc", flowColor: "#0f172a" }  // أبيض
];

const ARABIC_MONTH_NAMES = {
    "01": "يناير (كانون الثاني)",
    "02": "فبراير (شباط)",
    "03": "مارس (آذار)",
    "04": "أبريل (نيسان)",
    "05": "مايو (أيار)",
    "06": "يونيو (حزيران)",
    "07": "يوليو (تموز)",
    "08": "أغسطس (آب)",
    "09": "سبتمبر (أيلول)",
    "10": "أكتوبر (تشرين الأول)",
    "11": "نوفمبر (تشرين الثاني)",
    "12": "ديسمبر (كانون الأول)"
};

const DEFAULT_SHEET_BOX_LAYOUT = {
    dateShift: { label: "1. بوكس التاريخ", x: 56, y: 66, fontSize: 10 },
    readings: { label: "2. بوكس القراءات (طولي)", x: 6, y: 21, fontSize: 9.5 },
    equipment: { label: "3. الخطوط والسولارات", x: 56, y: 18, fontSize: 9.5 },
    results: { label: "4. بوكس النتائج الحسابية", x: 56, y: 45, fontSize: 10.5 },
    notes: { label: "5. بوكس الملاحظات", x: 56, y: 55, fontSize: 9.5 }
};

let sheetBoxLayout = JSON.parse(JSON.stringify(DEFAULT_SHEET_BOX_LAYOUT));
let selectedEditorBoxKey = 'dateShift';
let activeDragBoxKey = null;
let dragStartPointer = { x: 0, y: 0 };
let dragStartBoxPos = { x: 0, y: 0 };

let currentEmployee = null;
let founderEmployeesCache = [];
let activeFounderTab = 'pending';
let selectedEmployeeForRole = null;
let selectedEmployeeForShift = null;

let qutryState = 'off';
let solarAState = 'off';
let solarBState = 'off';

let unsubscribeLiveShift = null;
let activeWatchedDateKey = null;
let isApplyingRemoteUpdate = false;
let saveDebounceTimer = null;
let isAutoArchivingInProgress = false;

let geoWatchId = null;
let geoStatusState = 'checking';
let lastMeasuredDistanceMeters = null;

let unsubscribeHeaderBranding = null;
let currentPinnedHeaderImage = '';

let unsubscribeReadingSheetTemplate = null;
let unsubscribeReadingSheetLayout = null;
let currentReadingSheetTemplateImage = '';
let activeArchiveRecordForPrint = null;
let activeSheetRecordForExport = null;

let isEditingArchiveRecord = false;
let editArchiveQutryState = 'off';
let editArchiveSolarAState = 'off';
let editArchiveSolarBState = 'off';

let archiveRecordsCache = [];
let selectedCompletedMonthKey = null;

document.addEventListener("click", function(e) {
    if (!e.target.closest(".emp-dots-wrapper")) {
        document.querySelectorAll(".emp-menu-list.show").forEach(menu => menu.classList.remove("show"));
    }
    if (!e.target.closest(".menu-dropdown-container")) {
        const mainDrop = document.getElementById("dropdownMenu");
        if (mainDrop) mainDrop.classList.remove("show");
    }
});

document.addEventListener("pointermove", function(e) {
    if (!activeDragBoxKey) return;
    const stage = document.getElementById('layout-editor-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dxPct = ((e.clientX - dragStartPointer.x) / rect.width) * 100;
    const dyPct = ((e.clientY - dragStartPointer.y) / rect.height) * 100;

    sheetBoxLayout[activeDragBoxKey].x = Number((dragStartBoxPos.x + dxPct).toFixed(1));
    sheetBoxLayout[activeDragBoxKey].y = Number((dragStartBoxPos.y + dyPct).toFixed(1));

    renderEditorBoxesLayer();
});

document.addEventListener("pointerup", function() {
    activeDragBoxKey = null;
});

async function ensureFirebaseSession() {
    if (!auth.currentUser) {
        try {
            await auth.signInAnonymously();
        } catch (e) {
            console.warn("Anonymous auth note:", e.code);
        }
    }
}

function isFounderUser(empObj = currentEmployee) {
    if (!empObj) return false;
    return (empObj.email && empObj.email.toLowerCase().trim() === FOUNDER_EMAIL.toLowerCase().trim()) || empObj.isFounder === true;
}

function isGtuHeadUser(empObj = currentEmployee) {
    if (!empObj) return false;
    return String(empObj.responsibility || '').trim() === GTU_HEAD_ROLE;
}

function hasAdminPanelAccess(empObj = currentEmployee) {
    return isFounderUser(empObj) || isGtuHeadUser(empObj);
}

function normalizeBoxLayout(rawLayout) {
    const merged = JSON.parse(JSON.stringify(DEFAULT_SHEET_BOX_LAYOUT));
    if (!rawLayout || typeof rawLayout !== 'object') return merged;
    BOX_KEYS.forEach(key => {
        if (rawLayout[key]) {
            if (typeof rawLayout[key].x === 'number' && !isNaN(rawLayout[key].x)) merged[key].x = rawLayout[key].x;
            if (typeof rawLayout[key].y === 'number' && !isNaN(rawLayout[key].y)) merged[key].y = rawLayout[key].y;
            if (typeof rawLayout[key].fontSize === 'number' && !isNaN(rawLayout[key].fontSize) && rawLayout[key].fontSize > 0) merged[key].fontSize = rawLayout[key].fontSize;
        }
    });
    return merged;
}

function attachReadingSheetLayoutListener() {
    if (unsubscribeReadingSheetLayout) return;
    unsubscribeReadingSheetLayout = db.collection("app_settings_gas").doc("reading_sheet_layout")
        .onSnapshot((docSnap) => {
            if (docSnap.exists) {
                sheetBoxLayout = normalizeBoxLayout(docSnap.data());
            } else {
                sheetBoxLayout = JSON.parse(JSON.stringify(DEFAULT_SHEET_BOX_LAYOUT));
            }
            if (document.getElementById('boxLayoutEditorModal').style.display === 'flex' && !activeDragBoxKey) {
                renderEditorBoxesLayer();
                updateFontStepperDisplay();
            }
        }, (err) => {
            console.warn("Reading sheet layout listener note:", err.message);
        });
}

function renderReadingSheetTemplateUI(templateUrl) {
    currentReadingSheetTemplateImage = templateUrl || '';
    const cardSub = document.getElementById('reading-sheet-card-sub');
    const previewImg = document.getElementById('reading-sheet-preview-img');
    const emptyLabel = document.getElementById('reading-sheet-empty-label');
    const uploadLabel = document.getElementById('reading-sheet-upload-label');
    const removeBtn = document.getElementById('reading-sheet-remove-btn');

    if (cardSub) {
        cardSub.textContent = currentReadingSheetTemplateImage
            ? 'الصورة مثبتة بنفس قياسها • سحب البوكسات وتعديل الخط'
            : 'بنفس قياس الصورة المختارة وسحب البوكسات وتعديل الخط';
    }
    if (previewImg && emptyLabel) {
        if (currentReadingSheetTemplateImage) {
            previewImg.src = currentReadingSheetTemplateImage;
            previewImg.style.display = 'block';
            emptyLabel.style.display = 'none';
        } else {
            previewImg.src = '';
            previewImg.style.display = 'none';
            emptyLabel.style.display = 'block';
        }
    }
    if (uploadLabel) {
        uploadLabel.textContent = currentReadingSheetTemplateImage ? 'تغيير صورة الورقة' : 'اختيار وتثبيت صورة الورقة';
    }
    if (removeBtn) {
        removeBtn.style.display = currentReadingSheetTemplateImage ? 'flex' : 'none';
    }
}

function attachReadingSheetTemplateListener() {
    if (unsubscribeReadingSheetTemplate) return;
    unsubscribeReadingSheetTemplate = db.collection("app_settings_gas").doc("reading_sheet_template")
        .onSnapshot((docSnap) => {
            if (docSnap.exists) {
                const data = docSnap.data() || {};
                renderReadingSheetTemplateUI(data.imageUrl || '');
            } else {
                renderReadingSheetTemplateUI('');
            }
        }, (err) => {
            console.warn("Reading sheet template listener note:", err.message);
        });
}

function openReadingSheetModal() {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ إدارة صورة ورقة القرائات والبوكسات متاحة للمؤسس ومسؤول شعبة GTU فقط.');
        return;
    }
    renderReadingSheetTemplateUI(currentReadingSheetTemplateImage);
    document.getElementById('readingSheetConfigModal').style.display = 'flex';
}

function closeReadingSheetConfigModal() {
    document.getElementById('readingSheetConfigModal').style.display = 'none';
}

function triggerReadingSheetTemplatePicker() {
    if (!hasAdminPanelAccess(currentEmployee)) return;
    const input = document.getElementById('reading-sheet-file-input');
    if (input) {
        input.value = '';
        input.click();
    }
}

async function handleReadingSheetTemplateUpload(event) {
    if (!hasAdminPanelAccess(currentEmployee)) return;
    const file = event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;

    const uploadBtn = document.getElementById('reading-sheet-upload-btn');
    const uploadLabel = document.getElementById('reading-sheet-upload-label');
    if (uploadBtn) uploadBtn.disabled = true;
    if (uploadLabel) uploadLabel.textContent = 'جاري التثبيت...';

    await ensureFirebaseSession();

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.src = e.target.result;
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const MAX_SIDE = 1300;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_SIDE) { height = Math.round((height * MAX_SIDE) / width); width = MAX_SIDE; }
            } else {
                if (height > MAX_SIDE) { width = Math.round((width * MAX_SIDE) / height); height = MAX_SIDE; }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

            try {
                await db.collection("app_settings_gas").doc("reading_sheet_template").set({
                    imageUrl: compressedDataUrl,
                    originalWidth: img.width,
                    originalHeight: img.height,
                    updatedBy: currentEmployee ? currentEmployee.name : 'الإدارة',
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                renderReadingSheetTemplateUI(compressedDataUrl);
                alert('✅ تم تثبيت صورة الورقة بنفس قياسها بنجاح.');
            } catch (err) {
                alert('❌ تعذر حفظ صورة الورقة: ' + err.message);
            } finally {
                if (uploadBtn) uploadBtn.disabled = false;
                if (uploadLabel) uploadLabel.textContent = currentReadingSheetTemplateImage ? 'تغيير صورة الورقة' : 'اختيار وتثبيت صورة الورقة';
            }
        };
    };
    reader.readAsDataURL(file);
}

async function removeReadingSheetTemplate() {
    if (!hasAdminPanelAccess(currentEmployee)) return;
    if (!confirm('هل تريد إزالة صورة الورقة المثبتة؟')) return;

    await ensureFirebaseSession();
    try {
        await db.collection("app_settings_gas").doc("reading_sheet_template").set({
            imageUrl: '',
            updatedBy: currentEmployee ? currentEmployee.name : 'الإدارة',
            updatedAt: new Date().toISOString()
        }, { merge: true });
        renderReadingSheetTemplateUI('');
    } catch (err) {
        alert('❌ تعذر إزالة الصورة: ' + err.message);
    }
}

function formatStatusBadgeHtml(isOn) {
    if (isOn) {
        return `<span class="state-pill-on"><i class="fa-solid fa-circle-check"></i> تشغيل (ON)</span>`;
    }
    return `<span class="state-pill-off"><i class="fa-solid fa-circle-xmark"></i> إطفاء (OFF)</span>`;
}

function buildSolarUnitHtml(englishName, solarObj) {
    const isOn = Boolean(solarObj && solarObj.state === 'on');
    const sucVal = solarObj && solarObj.suc !== undefined && solarObj.suc !== '' ? solarObj.suc : '-';
    const disVal = solarObj && solarObj.dis !== undefined && solarObj.dis !== '' ? solarObj.dis : '-';

    const pressuresHtml = isOn
        ? `
            <div class="solar-pressures-stack">
                <div>Suction: <strong>${sucVal}</strong></div>
                <div>Discharge: <strong>${disVal}</strong></div>
            </div>
        `
        : '';

    return `
        <div class="solar-unit-block">
            <div class="solar-unit-top">
                <strong style="direction:ltr; white-space:nowrap; font-family:'Plus Jakarta Sans','Cairo',sans-serif;">${englishName}:</strong>
                ${formatStatusBadgeHtml(isOn)}
            </div>
            ${pressuresHtml}
        </div>
    `;
}

function buildFiveBoxesContent(recordData) {
    const d = recordData || collectCurrentFormData();
    const grids = Array.isArray(d.grids) ? d.grids : [];
    const strats = Array.isArray(d.strats) ? d.strats : [];
    const flows = Array.isArray(d.flows) ? d.flows : [];
    const qutryIsOn = d.qutry === 'on';
    const nationalVal = (d.national !== undefined && d.national !== null && String(d.national).trim() !== '') ? d.national : '-';
    const iranianVal = (d.iranian !== undefined && d.iranian !== null && String(d.iranian).trim() !== '') ? d.iranian : '-';

    let tableRowsHtml = `
        <div class="vertical-readings-row header-row">
            <span class="vertical-readings-cell">TIME</span>
            <span class="vertical-readings-cell">GRID</span>
            <span class="vertical-readings-cell">STRAT</span>
            <span class="vertical-readings-cell">FLOW</span>
        </div>
    `;

    hours.forEach((h, i) => {
        const pal = HOUR_ROW_PALETTE[i % HOUR_ROW_PALETTE.length];
        tableRowsHtml += `
            <div class="vertical-readings-row" style="background:${pal.bg};">
                <span class="vertical-readings-cell" style="background:${pal.timeBg};">${h}</span>
                <span class="vertical-readings-cell">${grids[i] || '-'}</span>
                <span class="vertical-readings-cell">${strats[i] || '-'}</span>
                <span class="vertical-readings-cell" style="color:${pal.flowColor};">${flows[i] || '-'}</span>
            </div>
        `;
    });

    const notesText = (d.notes && String(d.notes).trim() !== '')
        ? String(d.notes).trim()
        : 'لا توجد ملاحظات مسجلة.';

    return {
        dateShift: `
            <div class="ltr-transparent-box">
                <div style="white-space:nowrap;"><strong>Date:</strong> ${d.date || getActiveShiftDateKey()}</div>
            </div>
        `,
        readings: `
            <div class="vertical-readings-table">${tableRowsHtml}</div>
        `,
        equipment: `
            <div class="ltr-transparent-box">
                <div class="equip-inline-row" style="margin-bottom:4px;">
                    <strong>Qutry Compressor:</strong>
                    ${formatStatusBadgeHtml(qutryIsOn)}
                </div>
                <div style="margin-bottom:2px; white-space:nowrap;"><strong>National Line:</strong> <span>${nationalVal}</span></div>
                <div style="margin-bottom:5px; white-space:nowrap;"><strong>Iranian Line:</strong> <span>${iranianVal}</span></div>
                ${buildSolarUnitHtml('Solar A', d.solarA)}
                ${buildSolarUnitHtml('Solar B', d.solarB)}
            </div>
        `,
        results: `
            <div class="ltr-transparent-box" style="color:#15803d; font-weight:900;">
                <div style="white-space:nowrap;">TOTAL: ${d.total || '-'}</div>
                <div style="white-space:nowrap;">M³/DAY: ${d.m3day || '-'}</div>
            </div>
        `,
        notes: `
            <div style="font-weight:800; color:#0f172a; white-space:pre-line; max-width:260px;">${notesText}</div>
        `
    };
}

function openBoxLayoutEditorModal() {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ تعديل البوكسات وحجم الخط متاح للمؤسس ومسؤول شعبة GTU فقط.');
        return;
    }
    closeReadingSheetConfigModal();
    const bgImg = document.getElementById('layout-editor-bg-img');
    if (bgImg) {
        bgImg.src = currentReadingSheetTemplateImage || '';
    }
    selectEditorBox(selectedEditorBoxKey || 'dateShift');
    renderEditorBoxesLayer();
    document.getElementById('boxLayoutEditorModal').style.display = 'flex';
}

function closeBoxLayoutEditorModal() {
    activeDragBoxKey = null;
    document.getElementById('boxLayoutEditorModal').style.display = 'none';
}

function selectEditorBox(boxKey) {
    selectedEditorBoxKey = boxKey;
    BOX_KEYS.forEach(k => {
        const pill = document.getElementById(`pill-${k}`);
        if (pill) pill.classList.toggle('active', k === boxKey);
    });
    updateFontStepperDisplay();
    renderEditorBoxesLayer();
}

function updateFontStepperDisplay() {
    const cfg = sheetBoxLayout[selectedEditorBoxKey];
    if (!cfg) return;
    const titleEl = document.getElementById('selected-box-font-title');
    const valEl = document.getElementById('selected-box-font-value');
    if (titleEl) titleEl.textContent = `حجم خط (${cfg.label}):`;
    if (valEl) valEl.textContent = `${cfg.fontSize} px`;
}

function stepBoxFontSize(delta) {
    const cfg = sheetBoxLayout[selectedEditorBoxKey];
    if (!cfg) return;
    const nextSize = Math.max(7, Math.min(28, Number(cfg.fontSize || 10) + delta));
    cfg.fontSize = nextSize;
    updateFontStepperDisplay();
    renderEditorBoxesLayer();
}

function renderEditorBoxesLayer() {
    const layer = document.getElementById('layout-editor-boxes-layer');
    if (!layer) return;
    const sampleBoxes = buildFiveBoxesContent(collectCurrentFormData());
    layer.innerHTML = '';

    BOX_KEYS.forEach(key => {
        const cfg = sheetBoxLayout[key];
        const div = document.createElement('div');
        const isLtrBox = (key === 'dateShift' || key === 'equipment' || key === 'results');
        div.className = `sheet-data-box draggable-box ${isLtrBox ? 'ltr-box' : ''} ${selectedEditorBoxKey === key ? 'selected-box' : ''}`;
        div.style.left = `${cfg.x}%`;
        div.style.top = `${cfg.y}%`;
        div.style.fontSize = `${cfg.fontSize}px`;

        div.innerHTML = `
            <span class="sheet-box-badge"><i class="fa-solid fa-arrows-up-down-left-right"></i> ${cfg.label}</span>
            <div>${sampleBoxes[key]}</div>
        `;

        div.addEventListener("pointerdown", function(e) {
            e.preventDefault();
            e.stopPropagation();
            selectEditorBox(key);
            activeDragBoxKey = key;
            dragStartPointer = { x: e.clientX, y: e.clientY };
            dragStartBoxPos = { x: cfg.x, y: cfg.y };
        });

        layer.appendChild(div);
    });
}

async function saveSheetLayoutConfig() {
    if (!hasAdminPanelAccess(currentEmployee)) return;
    const btn = document.getElementById('save-layout-btn');
    if (btn) btn.disabled = true;

    await ensureFirebaseSession();
    try {
        await db.collection("app_settings_gas").doc("reading_sheet_layout").set({
            ...sheetBoxLayout,
            updatedBy: currentEmployee ? currentEmployee.name : 'الإدارة',
            updatedAt: new Date().toISOString()
        }, { merge: true });
        alert('✅ تم حفظ التعديلات واعتمادها لجميع الموظفين.');
    } catch (err) {
        alert('❌ تعذر حفظ التعديلات: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function resetSheetLayoutToDefault() {
    if (!confirm('هل تريد إعادة أماكن وحجوم البوكسات الخمسة إلى الوضع الافتراضي؟')) return;
    sheetBoxLayout = JSON.parse(JSON.stringify(DEFAULT_SHEET_BOX_LAYOUT));
    updateFontStepperDisplay();
    renderEditorBoxesLayer();
}

function openPrintableSheetForData(recordData) {
    if (!currentReadingSheetTemplateImage) {
        if (hasAdminPanelAccess(currentEmployee)) {
            alert('⚠️ لم يتم تثبيت (صورة ورقة القرائات) بعد. افتح أيقونة (صورة ورقة القرائات) لاختيارها وتثبيتها أولاً.');
            openReadingSheetModal();
        } else {
            alert('⚠️ لم يتم رفع صورة ورقة القرائات من قبل المؤسس أو مسؤول الشعبة بعد.');
        }
        return;
    }

    const targetRecord = recordData || collectCurrentFormData();
    activeSheetRecordForExport = targetRecord;

    const bgImg = document.getElementById('printable-sheet-bg-img');
    const boxesLayer = document.getElementById('printable-sheet-boxes-layer');
    const editLayoutBtn = document.getElementById('print-modal-edit-layout-btn');

    if (bgImg) bgImg.src = currentReadingSheetTemplateImage;
    if (editLayoutBtn) editLayoutBtn.style.display = hasAdminPanelAccess(currentEmployee) ? 'flex' : 'none';

    const boxHtmlMap = buildFiveBoxesContent(targetRecord);
    if (boxesLayer) {
        boxesLayer.innerHTML = '';
        BOX_KEYS.forEach(key => {
            const cfg = sheetBoxLayout[key];
            const boxEl = document.createElement('div');
            const isLtrBox = (key === 'dateShift' || key === 'equipment' || key === 'results');
            boxEl.className = `sheet-data-box ${isLtrBox ? 'ltr-box' : ''}`;
            boxEl.style.left = `${cfg.x}%`;
            boxEl.style.top = `${cfg.y}%`;
            boxEl.style.fontSize = `${cfg.fontSize}px`;
            boxEl.innerHTML = boxHtmlMap[key];
            boxesLayer.appendChild(boxEl);
        });
    }

    document.getElementById('readingSheetPrintModal').style.display = 'flex';
}

function closeReadingSheetPrintModal() {
    document.getElementById('readingSheetPrintModal').style.display = 'none';
}

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
    });
}

function drawRoundedRectCanvas(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function drawStatusPillCanvas(ctx, isOn, x, y, fontPx) {
    const text = isOn ? '✓ تشغيل (ON)' : '✕ إطفاء (OFF)';
    ctx.save();
    ctx.direction = 'rtl';
    ctx.font = `900 ${fontPx}px 'Cairo', 'Plus Jakarta Sans', sans-serif`;
    const textWidth = ctx.measureText(text).width;
    const padX = Math.max(5, Math.round(fontPx * 0.55));
    const pillH = Math.round(fontPx * 1.48);
    const pillW = Math.ceil(textWidth + padX * 2);

    drawRoundedRectCanvas(ctx, x, y, pillW, pillH, pillH / 2);
    ctx.fillStyle = isOn ? '#dcfce7' : '#fee2e2';
    ctx.fill();
    ctx.lineWidth = Math.max(1, fontPx * 0.09);
    ctx.strokeStyle = isOn ? '#22c55e' : '#ef4444';
    ctx.stroke();

    ctx.fillStyle = isOn ? '#15803d' : '#b91c1c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pillW / 2, y + pillH / 2 + 0.5);
    ctx.restore();
    return { width: pillW, height: pillH };
}

function wrapCanvasLines(ctx, text, maxWidth) {
    const paragraphs = String(text || '').split('\n');
    const lines = [];
    paragraphs.forEach(para => {
        const words = para.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            lines.push('');
            return;
        }
        let current = words[0];
        for (let i = 1; i < words.length; i++) {
            const testLine = current + ' ' + words[i];
            if (ctx.measureText(testLine).width <= maxWidth) {
                current = testLine;
            } else {
                lines.push(current);
                current = words[i];
            }
        }
        lines.push(current);
    });
    return lines;
}

async function renderHighResReadingSheetBlob(recordData) {
    const d = recordData || activeSheetRecordForExport || collectCurrentFormData();
    const stageEl = document.getElementById('reading-sheet-printable-stage');
    const bgImgEl = document.getElementById('printable-sheet-bg-img');

    const bgImg = await loadImageElement(currentReadingSheetTemplateImage);
    const stageRect = stageEl ? stageEl.getBoundingClientRect() : null;
    const displayW = (stageRect && stageRect.width > 10) ? stageRect.width : (bgImgEl && bgImgEl.clientWidth > 10 ? bgImgEl.clientWidth : bgImg.naturalWidth);
    const displayH = (stageRect && stageRect.height > 10) ? stageRect.height : (bgImgEl && bgImgEl.clientHeight > 10 ? bgImgEl.clientHeight : bgImg.naturalHeight);

    const exportScale = Math.max(2, (bgImg.naturalWidth || displayW) / Math.max(1, displayW));
    const canvasW = Math.round(displayW * exportScale);
    const canvasH = Math.round(displayH * exportScale);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(bgImg, 0, 0, canvasW, canvasH);

    const grids = Array.isArray(d.grids) ? d.grids : [];
    const strats = Array.isArray(d.strats) ? d.strats : [];
    const flows = Array.isArray(d.flows) ? d.flows : [];
    const qutryIsOn = d.qutry === 'on';
    const nationalVal = (d.national !== undefined && d.national !== null && String(d.national).trim() !== '') ? String(d.national) : '-';
    const iranianVal = (d.iranian !== undefined && d.iranian !== null && String(d.iranian).trim() !== '') ? String(d.iranian) : '-';
    const dateStr = String(d.date || getActiveShiftDateKey());
    const notesStr = (d.notes && String(d.notes).trim() !== '') ? String(d.notes).trim() : 'لا توجد ملاحظات مسجلة.';

    BOX_KEYS.forEach(key => {
        const cfg = sheetBoxLayout[key];
        const baseX = (cfg.x / 100) * canvasW;
        const baseY = (cfg.y / 100) * canvasH;
        const fSize = Math.round((cfg.fontSize || 10) * exportScale);
        const pad = Math.round(5 * exportScale);
        const lineH = Math.round(fSize * 1.38);

        if (key === 'dateShift') {
            ctx.save();
            ctx.direction = 'ltr';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = `900 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
            ctx.fillStyle = '#0f172a';
            const lbl = 'Date: ';
            ctx.fillText(lbl, baseX + pad, baseY + pad + lineH / 2);
            const lblW = ctx.measureText(lbl).width;
            ctx.font = `800 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
            ctx.fillText(dateStr, baseX + pad + lblW, baseY + pad + lineH / 2);
            ctx.restore();
        } else if (key === 'readings') {
            const cols = ['TIME', 'GRID', 'STRAT', 'FLOW'];
            const rows = [cols];
            hours.forEach((h, i) => {
                rows.push([h, grids[i] || '-', strats[i] || '-', flows[i] || '-']);
            });

            ctx.save();
            ctx.direction = 'ltr';
            ctx.font = `800 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
            const cellPadX = Math.round(6 * exportScale);
            const cellPadY = Math.round(2.8 * exportScale);
            const rowGap = Math.round(1.2 * exportScale);
            const rowH = fSize + cellPadY * 2;

            const colWidths = cols.map((colTitle, cIdx) => {
                let maxW = ctx.measureText(colTitle).width;
                for (let r = 1; r < rows.length; r++) {
                    const w = ctx.measureText(String(rows[r][cIdx])).width;
                    if (w > maxW) maxW = w;
                }
                return Math.ceil(maxW + cellPadX * 2);
            });

            const innerW = colWidths.reduce((a, b) => a + b, 0);
            const innerH = rowH * rows.length + rowGap * (rows.length - 1);
            const boxW = innerW + pad * 2;
            const boxH = innerH + pad * 2;

            drawRoundedRectCanvas(ctx, baseX, baseY, boxW, boxH, Math.round(8 * exportScale));
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.fill();

            let curY = baseY + pad;
            rows.forEach((rData, rIdx) => {
                const pal = rIdx > 0 ? HOUR_ROW_PALETTE[(rIdx - 1) % HOUR_ROW_PALETTE.length] : null;
                if (rIdx === 0) {
                    drawRoundedRectCanvas(ctx, baseX + pad, curY, innerW, rowH, Math.round(4 * exportScale));
                    ctx.fillStyle = '#0f172a';
                    ctx.fill();
                } else if (pal) {
                    drawRoundedRectCanvas(ctx, baseX + pad, curY, innerW, rowH, Math.round(4 * exportScale));
                    ctx.fillStyle = pal.bg;
                    ctx.fill();
                }

                let curX = baseX + pad;
                rData.forEach((cellVal, cIdx) => {
                    const cw = colWidths[cIdx];
                    if (rIdx > 0 && cIdx === 0 && pal) {
                        drawRoundedRectCanvas(ctx, curX, curY, cw, rowH, Math.round(4 * exportScale));
                        ctx.fillStyle = pal.timeBg;
                        ctx.fill();
                    }

                    if (rIdx === 0) {
                        ctx.font = `900 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                        ctx.fillStyle = '#ffffff';
                    } else if (cIdx === 0) {
                        ctx.font = `900 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                        ctx.fillStyle = '#0f172a';
                    } else if (cIdx === 3 && pal) {
                        ctx.font = `800 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                        ctx.fillStyle = pal.flowColor;
                    } else {
                        ctx.font = `700 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                        ctx.fillStyle = '#0f172a';
                    }

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(cellVal), curX + cw / 2, curY + rowH / 2 + 0.5);

                    if (cIdx < colWidths.length - 1) {
                        ctx.strokeStyle = rIdx === 0 ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.10)';
                        ctx.beginPath();
                        ctx.moveTo(curX + cw, curY);
                        ctx.lineTo(curX + cw, curY + rowH);
                        ctx.stroke();
                    }
                    curX += cw;
                });

                curY += rowH + rowGap;
            });
            ctx.restore();
        } else if (key === 'equipment') {
            const pillFont = Math.max(7, Math.round(fSize * 0.9));
            const pillH = Math.round(pillFont * 1.48);
            const gap = Math.round(4 * exportScale);

            ctx.save();
            ctx.direction = 'ltr';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            let yCursor = baseY + pad;
            const leftX = baseX + pad;

            ctx.font = `900 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
            ctx.fillStyle = '#0f172a';
            const qLbl = 'Qutry Compressor: ';
            ctx.fillText(qLbl, leftX, yCursor + pillH / 2);
            const qLblW = ctx.measureText(qLbl).width;
            drawStatusPillCanvas(ctx, qutryIsOn, leftX + qLblW + Math.round(4 * exportScale), yCursor, pillFont);
            yCursor += pillH + gap;

            const drawLtrField = (lbl, val) => {
                ctx.font = `900 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                ctx.fillStyle = '#0f172a';
                ctx.fillText(lbl, leftX, yCursor + lineH / 2);
                const lw = ctx.measureText(lbl).width;
                ctx.font = `800 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                ctx.fillText(val, leftX + lw, yCursor + lineH / 2);
                yCursor += lineH + gap;
            };

            drawLtrField('National Line: ', nationalVal);
            drawLtrField('Iranian Line: ', iranianVal);

            const drawLtrSolar = (solarName, solarObj) => {
                const isOn = Boolean(solarObj && solarObj.state === 'on');
                ctx.font = `900 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                ctx.fillStyle = '#0f172a';
                const sLbl = `${solarName}: `;
                ctx.fillText(sLbl, leftX, yCursor + pillH / 2);
                const sLblW = ctx.measureText(sLbl).width;
                drawStatusPillCanvas(ctx, isOn, leftX + sLblW + Math.round(4 * exportScale), yCursor, pillFont);
                yCursor += pillH + Math.round(2 * exportScale);

                if (isOn) {
                    const sucV = (solarObj && solarObj.suc !== undefined && solarObj.suc !== '') ? solarObj.suc : '-';
                    const disV = (solarObj && solarObj.dis !== undefined && solarObj.dis !== '') ? solarObj.dis : '-';
                    const indentX = leftX + Math.round(8 * exportScale);
                    ctx.font = `800 ${pillFont}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
                    ctx.fillStyle = '#065f46';
                    ctx.fillText(`Suction: ${sucV}`, indentX, yCursor + lineH / 2);
                    yCursor += lineH;
                    ctx.fillText(`Discharge: ${disV}`, indentX, yCursor + lineH / 2);
                    yCursor += lineH + Math.round(2 * exportScale);
                }
                yCursor += gap;
            };

            drawLtrSolar('Solar A', d.solarA);
            drawLtrSolar('Solar B', d.solarB);
            ctx.restore();
        } else if (key === 'results') {
            const line1 = `TOTAL: ${d.total || '-'}`;
            const line2 = `M³/DAY: ${d.m3day || '-'}`;

            ctx.save();
            ctx.direction = 'ltr';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = `900 ${fSize}px 'Plus Jakarta Sans', 'Cairo', sans-serif`;
            ctx.fillStyle = '#15803d';
            ctx.fillText(line1, baseX + pad, baseY + pad + lineH / 2);
            ctx.fillText(line2, baseX + pad, baseY + pad + lineH + lineH / 2);
            ctx.restore();
        } else if (key === 'notes') {
            const maxNoteW = Math.min(Math.round(250 * exportScale), Math.max(Math.round(90 * exportScale), canvasW - baseX - pad * 3));
            ctx.save();
            ctx.direction = 'rtl';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.font = `800 ${fSize}px 'Cairo', sans-serif`;
            const lines = wrapCanvasLines(ctx, notesStr, maxNoteW);
            let maxLineW = 0;
            lines.forEach(l => {
                const mw = ctx.measureText(l).width;
                if (mw > maxLineW) maxLineW = mw;
            });
            const boxW = Math.max(Math.round(60 * exportScale), Math.ceil(maxLineW));
            ctx.fillStyle = '#0f172a';
            lines.forEach((lineText, idx) => {
                ctx.fillText(lineText, baseX + boxW, baseY + pad + idx * lineH + lineH / 2);
            });
            ctx.restore();
        }
    });

    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
    });
}

async function shareReadingSheetViaWhatsApp() {
    if (!currentReadingSheetTemplateImage) {
        alert('⚠️ لا توجد صورة مثبتة لورقة القرائات.');
        return;
    }

    const btn = document.getElementById('share-whatsapp-sheet-btn');
    const label = document.getElementById('share-whatsapp-sheet-label');
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'جاري تحويلها إلى صورة...';

    try {
        const record = activeSheetRecordForExport || collectCurrentFormData();
        const blob = await renderHighResReadingSheetBlob(record);
        if (!blob) {
            throw new Error('تعذر إنشاء ملف الصورة.');
        }

        const safeDate = String(record.date || getActiveShiftDateKey()).replace(/[^0-9-]/g, '');
        const fileName = `قراءات_الرميلة_الشمالية_${safeDate}.png`;
        const imageFile = new File([blob], fileName, { type: 'image/png' });

        const canShareFiles = typeof navigator.share === 'function' &&
            (!navigator.canShare || navigator.canShare({ files: [imageFile] }));

        if (canShareFiles) {
            await navigator.share({
                files: [imageFile]
            });
        } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            window.open('https://wa.me/', '_blank', 'noopener,noreferrer');
        }
    } catch (err) {
        if (err && err.name === 'AbortError') {
            return;
        }
        alert('❌ تعذر مشاركة الصورة: ' + (err.message || err));
    } finally {
        if (btn) btn.disabled = false;
        if (label) label.textContent = 'مشاركة عبر واتساب';
    }
}

function renderDashboardPinnedImageUI(imageUrl) {
    currentPinnedHeaderImage = imageUrl || '';
    const defaultIcon = document.getElementById('dashboard-default-icon');
    const customImg = document.getElementById('dashboard-custom-image');
    const adminControls = document.getElementById('dashboard-image-admin-controls');
    const uploadLabel = document.getElementById('dashboard-upload-btn-label');
    const removeBtn = document.getElementById('dashboard-remove-btn');

    if (currentPinnedHeaderImage) {
        if (customImg) {
            customImg.src = currentPinnedHeaderImage;
            customImg.style.display = 'block';
        }
        if (defaultIcon) defaultIcon.style.display = 'none';
        if (uploadLabel) uploadLabel.textContent = 'تغيير الصورة';
        if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else {
        if (customImg) {
            customImg.src = '';
            customImg.style.display = 'none';
        }
        if (defaultIcon) defaultIcon.style.display = 'block';
        if (uploadLabel) uploadLabel.textContent = 'إضافة صورة';
        if (removeBtn) removeBtn.style.display = 'none';
    }

    if (adminControls) {
        adminControls.style.display = hasAdminPanelAccess(currentEmployee) ? 'flex' : 'none';
    }
}

function attachHeaderBrandingListener() {
    if (unsubscribeHeaderBranding) return;
    unsubscribeHeaderBranding = db.collection("app_settings_gas").doc("header_branding")
        .onSnapshot((docSnap) => {
            if (docSnap.exists) {
                const data = docSnap.data() || {};
                renderDashboardPinnedImageUI(data.imageUrl || '');
            } else {
                renderDashboardPinnedImageUI('');
            }
        }, (err) => {
            console.warn("Header branding listener note:", err.message);
        });
}

function triggerDashboardImagePicker() {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ إضافة أو تعديل الصورة المثبتة متاح للمؤسس ومسؤول شعبة GTU فقط.');
        return;
    }
    const fileInput = document.getElementById('dashboard-image-file-input');
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
}

async function handleDashboardImageUpload(event) {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ إضافة أو تعديل الصورة المثبتة متاح للمؤسس ومسؤول شعبة GTU فقط.');
        return;
    }
    const file = event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;

    const uploadBtn = document.getElementById('dashboard-upload-btn');
    const uploadLabel = document.getElementById('dashboard-upload-btn-label');
    if (uploadBtn) uploadBtn.disabled = true;
    if (uploadLabel) uploadLabel.textContent = 'جاري التثبيت...';

    await ensureFirebaseSession();

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.src = e.target.result;
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 500;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
            } else {
                if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.72);

            try {
                await db.collection("app_settings_gas").doc("header_branding").set({
                    imageUrl: compressedDataUrl,
                    updatedBy: currentEmployee ? currentEmployee.name : 'الإدارة',
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                renderDashboardPinnedImageUI(compressedDataUrl);
                alert('✅ تم تثبيت الصورة وستظهر لدى جميع المستخدمين.');
            } catch (err) {
                alert('❌ تعذر حفظ الصورة: ' + err.message);
            } finally {
                if (uploadBtn) uploadBtn.disabled = false;
                if (uploadLabel) uploadLabel.textContent = currentPinnedHeaderImage ? 'تغيير الصورة' : 'إضافة صورة';
            }
        };
    };
    reader.readAsDataURL(file);
}

async function removeDashboardPinnedImage() {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ إزالة الصورة المثبتة متاحة للمؤسس ومسؤول شعبة GTU فقط.');
        return;
    }
    if (!confirm('هل تريد إزالة الصورة المثبتة والعودة إلى الأيقونة الافتراضية لدى الجميع؟')) return;

    await ensureFirebaseSession();
    try {
        await db.collection("app_settings_gas").doc("header_branding").set({
            imageUrl: '',
            updatedBy: currentEmployee ? currentEmployee.name : 'الإدارة',
            updatedAt: new Date().toISOString()
        }, { merge: true });
        renderDashboardPinnedImageUI('');
    } catch (err) {
        alert('❌ تعذر إزالة الصورة: ' + err.message);
    }
}

function applyAdminLabelsForCurrentUser() {
    const isFounder = isFounderUser(currentEmployee);
    const isGtuHead = isGtuHeadUser(currentEmployee);
    const cardTitle = document.getElementById('admin-card-title');
    const panelTitle = document.getElementById('admin-panel-header-title');
    const panelSub = document.getElementById('admin-panel-header-sub');

    if (isGtuHead && !isFounder) {
        if (cardTitle) cardTitle.textContent = 'صلاحيات مسؤول الشعبة';
        if (panelTitle) panelTitle.textContent = 'صلاحيات مسؤول الشعبة';
        if (panelSub) panelSub.textContent = 'كافة الصلاحيات الإدارية: الموافقة، الحذف، نقل الكادر، المسؤوليات، ونقل رتبة مسؤول الشعبة';
    } else {
        if (cardTitle) cardTitle.textContent = 'إدارة حسابات الموظفين والموافقات';
        if (panelTitle) panelTitle.textContent = 'لوحة تحكم المؤسس';
        if (panelSub) panelSub.textContent = 'إدارة طلبات الانضمام، كافة الموظفين، الوجبات الأربع، وكادر المحافظات';
    }

    renderDashboardPinnedImageUI(currentPinnedHeaderImage);
    renderReadingSheetTemplateUI(currentReadingSheetTemplateImage);
}

function isGovernorateStaff(empObj) {
    if (!empObj) return false;
    return empObj.isGovernorateStaff === true || String(empObj.staffCategory || '').trim() === 'governorate';
}

function isExemptFromGeoAndShiftLock() {
    return hasAdminPanelAccess(currentEmployee);
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

function handleGeoPositionSuccess(position) {
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;
    const distance = calculateDistanceMeters(userLat, userLng, WORKSITE_LAT, WORKSITE_LNG);
    lastMeasuredDistanceMeters = distance;
    geoStatusState = distance <= WORKSITE_RADIUS_METERS ? 'inside' : 'outside';
    applyDutyPermissionToTodayForm(getActiveShiftDateKey());
}

function handleGeoPositionError(err) {
    lastMeasuredDistanceMeters = null;
    geoStatusState = 'denied';
    applyDutyPermissionToTodayForm(getActiveShiftDateKey());
}

function startGeofenceTracking() {
    if (isExemptFromGeoAndShiftLock()) {
        geoStatusState = 'inside';
        applyDutyPermissionToTodayForm(getActiveShiftDateKey());
        return;
    }
    if (!navigator.geolocation) {
        geoStatusState = 'unsupported';
        applyDutyPermissionToTodayForm(getActiveShiftDateKey());
        return;
    }

    if (geoWatchId !== null) {
        navigator.geolocation.clearWatch(geoWatchId);
        geoWatchId = null;
    }

    geoStatusState = 'checking';
    applyDutyPermissionToTodayForm(getActiveShiftDateKey());

    navigator.geolocation.getCurrentPosition(
        handleGeoPositionSuccess,
        handleGeoPositionError,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );

    geoWatchId = navigator.geolocation.watchPosition(
        handleGeoPositionSuccess,
        handleGeoPositionError,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
}

function requestUserGeolocation(showAlertOnFail = false) {
    if (!navigator.geolocation) {
        if (showAlertOnFail) alert('المتصفح لا يدعم تحديد الموقع الجغرافي.');
        return;
    }
    geoStatusState = 'checking';
    applyDutyPermissionToTodayForm(getActiveShiftDateKey());
    navigator.geolocation.getCurrentPosition(
        handleGeoPositionSuccess,
        (err) => {
            handleGeoPositionError(err);
            if (showAlertOnFail) {
                alert('⚠️ تعذر تحديد موقعك. يرجى تفعيل خدمة الموقع (GPS) والسماح للمتصفح بالوصول إلى الموقع.');
            }
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
}

function formatLocalDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getActiveShiftDateKey(referenceDate = new Date()) {
    const d = new Date(referenceDate.getTime());
    const totalMinutes = d.getHours() * 60 + d.getMinutes();
    if (totalMinutes < 390) {
        d.setDate(d.getDate() - 1);
    }
    return formatLocalDateKey(d);
}

function getPreviousShiftDateKey(currentShiftKey) {
    const parts = currentShiftKey.split('-').map(Number);
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    dt.setDate(dt.getDate() - 1);
    return formatLocalDateKey(dt);
}

function getDutyShiftNumberForDate(shiftDateKey) {
    const [y1, m1, d1] = SHIFT_ANCHOR_DATE_KEY.split('-').map(Number);
    const [y2, m2, d2] = shiftDateKey.split('-').map(Number);
    const utc1 = Date.UTC(y1, m1 - 1, d1);
    const utc2 = Date.UTC(y2, m2 - 1, d2);
    const diffDays = Math.floor((utc2 - utc1) / 86400000);
    return (((diffDays % 4) + 4) % 4) + 1;
}

function isUserAllowedToEnterReadings(shiftDateKey) {
    if (!currentEmployee) return false;
    if (isExemptFromGeoAndShiftLock()) return true;

    if (isGovernorateStaff(currentEmployee)) {
        return geoStatusState === 'inside';
    }

    const empShift = Number(currentEmployee.shiftGroup || 1);
    const dutyShift = getDutyShiftNumberForDate(shiftDateKey);
    if (empShift !== dutyShift) return false;

    return geoStatusState === 'inside';
}

function applyDutyPermissionToTodayForm(shiftDateKey) {
    const exempt = isExemptFromGeoAndShiftLock();
    const isGov = isGovernorateStaff(currentEmployee);
    const canEdit = isUserAllowedToEnterReadings(shiftDateKey);
    const dutyShift = getDutyShiftNumberForDate(shiftDateKey);
    const empShift = currentEmployee ? Number(currentEmployee.shiftGroup || 1) : 0;

    const appBody = document.getElementById('today-app-body');
    const banner = document.getElementById('rest-view-only-banner');
    const bannerText = document.getElementById('rest-view-only-text');
    const retryBtn = document.getElementById('geo-retry-btn');
    const geoHeaderLabel = document.getElementById('geo-status-header-label');

    if (geoHeaderLabel) {
        if (exempt) {
            const roleTag = isGtuHeadUser(currentEmployee) && !isFounderUser(currentEmployee) ? 'صلاحيات مسؤول الشعبة' : 'المؤسس';
            geoHeaderLabel.style.color = '#fcd34d';
            geoHeaderLabel.textContent = `صلاحية مفتوحة (${roleTag}) • بدون تقييد جغرافي`;
        } else if (geoStatusState === 'inside') {
            geoHeaderLabel.style.color = '#5eead4';
            geoHeaderLabel.textContent = isGov
                ? `كادر المحافظات • داخل موقع العمل (${lastMeasuredDistanceMeters ?? 0} م / الحد ${WORKSITE_RADIUS_METERS} م)`
                : `داخل نطاق موقع العمل (${lastMeasuredDistanceMeters ?? 0} م / الحد ${WORKSITE_RADIUS_METERS} م)`;
        } else if (geoStatusState === 'outside') {
            geoHeaderLabel.style.color = '#fca5a5';
            geoHeaderLabel.textContent = isGov
                ? `كادر المحافظات • خارج موقع العمل (${lastMeasuredDistanceMeters} م — مشاهدة فقط)`
                : `خارج نطاق موقع العمل (${lastMeasuredDistanceMeters} م عن المركز — الحد ${WORKSITE_RADIUS_METERS} م)`;
        } else if (geoStatusState === 'checking') {
            geoHeaderLabel.style.color = '#fde68a';
            geoHeaderLabel.textContent = 'جاري التحقق من الموقع الجغرافي...';
        } else {
            geoHeaderLabel.style.color = '#fca5a5';
            geoHeaderLabel.textContent = 'الموقع الجغرافي غير مفعّل (وضع المشاهدة فقط)';
        }
    }

    if (appBody) {
        appBody.classList.toggle('readonly-mode', !canEdit);
    }
    if (banner) {
        banner.classList.toggle('show', !canEdit);
        if (!canEdit && bannerText) {
            if (isGov) {
                if (geoStatusState === 'outside') {
                    bannerText.textContent = `أنت ضمن (كادر المحافظات) وخارج موقع العمل حالياً (المسافة: ${lastMeasuredDistanceMeters} متر، المسموح: ${WORKSITE_RADIUS_METERS} متر). لا يمكنك إضافة أو تعديل أي قراءة إلا عند تواجدك داخل الموقع.`;
                    if (retryBtn) retryBtn.style.display = 'inline-flex';
                } else if (geoStatusState === 'checking') {
                    bannerText.textContent = `جاري التحقق من تواجدك داخل موقع العمل لكادر المحافظات (نطاق ${WORKSITE_RADIUS_METERS} متر)...`;
                    if (retryBtn) retryBtn.style.display = 'none';
                } else {
                    bannerText.textContent = `أنت ضمن (كادر المحافظات): يرجى تفعيل الموقع (GPS) والسماح بالوصول للموقع للتحقق من وجودك داخل المحطة. حالياً وضع المشاهدة فقط متاح.`;
                    if (retryBtn) retryBtn.style.display = 'inline-flex';
                }
            } else if (empShift !== dutyShift) {
                bannerText.textContent = `أنت في الوجبة (${empShift}) وهي بالاستراحة اليوم (الوجبة المناوبة حالياً: وجبة ${dutyShift}). المشاهدة فقط متاحة ولا يمكن إدخال القراءات.`;
                if (retryBtn) retryBtn.style.display = 'none';
            } else if (geoStatusState === 'outside') {
                bannerText.textContent = `أنت خارج الرقعة الجغرافية لموقع العمل (المسافة الحالية: ${lastMeasuredDistanceMeters} متر، والحد المسموح: ${WORKSITE_RADIUS_METERS} متر). المشاهدة فقط متاحة.`;
                if (retryBtn) retryBtn.style.display = 'inline-flex';
            } else if (geoStatusState === 'checking') {
                bannerText.textContent = `جاري التحقق من وجودك داخل موقع العمل (ضمن نطاق ${WORKSITE_RADIUS_METERS} متر)...`;
                if (retryBtn) retryBtn.style.display = 'none';
            } else {
                bannerText.textContent = `يرجى تفعيل خدمة الموقع (GPS) والسماح بالوصول للموقع للتحقق من وجودك داخل المحطة (نطاق ${WORKSITE_RADIUS_METERS} متر). حالياً وضع المشاهدة فقط متاح.`;
                if (retryBtn) retryBtn.style.display = 'inline-flex';
            }
        }
    }

    hours.forEach((h, i) => {
        const g = document.getElementById(`grid_${i}`);
        const s = document.getElementById(`strat_${i}`);
        const f = document.getElementById(`flow_${i}`);
        if (g) { g.disabled = !canEdit; g.readOnly = !canEdit; }
        if (s) { s.disabled = !canEdit; s.readOnly = !canEdit; }
        if (f) { f.disabled = !canEdit; f.readOnly = !canEdit; }
    });

    ['nationalLine', 'iranianLine', 'solarA_suc', 'solarA_dis', 'solarB_suc', 'solarB_dis', 'shiftNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = !canEdit; el.readOnly = !canEdit; }
    });

    ['qutry_off', 'qutry_on', 'solarA_off', 'solarA_on', 'solarB_off', 'solarB_on'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !canEdit;
    });
}

function hasAnyShiftEntry(data) {
    if (!data) return false;
    const hasGrids = Array.isArray(data.grids) && data.grids.some(v => v !== '' && v !== null && v !== undefined);
    const hasStrats = Array.isArray(data.strats) && data.strats.some(v => v !== '' && v !== null && v !== undefined);
    const hasFlows = Array.isArray(data.flows) && data.flows.some(v => v !== '' && v !== null && v !== undefined);
    const hasLines = Boolean((data.national && String(data.national).trim() !== '') || (data.iranian && String(data.iranian).trim() !== ''));
    const hasSolar = Boolean(
        (data.solarA && (data.solarA.state === 'on' || data.solarA.suc || data.solarA.dis)) ||
        (data.solarB && (data.solarB.state === 'on' || data.solarB.suc || data.solarB.dis))
    );
    const hasQutry = data.qutry === 'on';
    const hasNotes = Boolean(data.notes && String(data.notes).trim() !== '');
    return hasGrids || hasStrats || hasFlows || hasLines || hasSolar || hasQutry || hasNotes;
}

async function upsertArchiveRecordByDate(recordData) {
    if (!recordData || !recordData.date) return;
    await ensureFirebaseSession();
    const existingSnap = await db.collection("shift_archive_gas")
        .where("date", "==", recordData.date)
        .get();

    if (!existingSnap.empty) {
        const batch = db.batch();
        existingSnap.forEach(doc => {
            batch.set(doc.ref, recordData, { merge: true });
        });
        await batch.commit();
    } else {
        await db.collection("shift_archive_gas").add(recordData);
    }
}

async function archiveShiftKeyDirectly(shiftKeyToArchive, fallbackLocalData = null) {
    if (!shiftKeyToArchive) return;
    await ensureFirebaseSession();

    let shiftDocSnap = null;
    try {
        shiftDocSnap = await db.collection("active_shift_gas").doc(shiftKeyToArchive).get({ source: 'server' });
    } catch (e) {
        shiftDocSnap = await db.collection("active_shift_gas").doc(shiftKeyToArchive).get();
    }

    let dataToArchive = null;
    if (shiftDocSnap && shiftDocSnap.exists) {
        dataToArchive = { ...shiftDocSnap.data(), date: shiftKeyToArchive };
    } else if (fallbackLocalData) {
        dataToArchive = { ...fallbackLocalData, date: shiftKeyToArchive };
    }

    if (dataToArchive && hasAnyShiftEntry(dataToArchive)) {
        dataToArchive.archivedAt = new Date().toISOString();
        if (!dataToArchive.recordedBy) {
            dataToArchive.recordedBy = dataToArchive.updatedBy || (currentEmployee ? currentEmployee.name : 'تلقائي');
        }
        await upsertArchiveRecordByDate(dataToArchive);
    }

    await db.collection("active_shift_gas").doc(shiftKeyToArchive).delete().catch(() => {});
    localStorage.removeItem('shift_data_gas_' + shiftKeyToArchive);
}

async function checkAndRunAutoArchiveAt630() {
    if (isAutoArchivingInProgress) return;
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();

    if (totalMinutes < 390) return;

    const currentShiftKey = getActiveShiftDateKey(now);
    const lastAutoArchivedForKey = localStorage.getItem('last_auto_archived_shift_key');
    const prevShiftKey = getPreviousShiftDateKey(currentShiftKey);
    const localPrevDataRaw = localStorage.getItem('shift_data_gas_' + prevShiftKey);

    let prevDocExists = false;
    if (lastAutoArchivedForKey !== currentShiftKey) {
        await ensureFirebaseSession();
        try {
            const prevSnap = await db.collection("active_shift_gas").doc(prevShiftKey).get({ source: 'server' });
            prevDocExists = prevSnap && prevSnap.exists;
        } catch (e) {
            const prevSnap = await db.collection("active_shift_gas").doc(prevShiftKey).get();
            prevDocExists = prevSnap && prevSnap.exists;
        }
    }

    if (lastAutoArchivedForKey !== currentShiftKey || prevDocExists || localPrevDataRaw) {
        isAutoArchivingInProgress = true;
        try {
            let localPrevData = null;
            if (localPrevDataRaw) {
                try { localPrevData = JSON.parse(localPrevDataRaw); } catch (e) {}
            }

            await archiveShiftKeyDirectly(prevShiftKey, localPrevData);
            localStorage.setItem('last_auto_archived_shift_key', currentShiftKey);

            if (activeWatchedDateKey && activeWatchedDateKey !== currentShiftKey) {
                if (unsubscribeLiveShift) {
                    unsubscribeLiveShift();
                    unsubscribeLiveShift = null;
                }
                activeWatchedDateKey = null;
            }

            const dateLabel = document.getElementById('current-shift-date-label');
            if (dateLabel) {
                const dutyShift = getDutyShiftNumberForDate(currentShiftKey);
                dateLabel.textContent = `تاريخ الوردية النشطة: ${currentShiftKey} • الوجبة المناوبة: وجبة ${dutyShift}`;
            }

            const activeTodaySnap = await db.collection("active_shift_gas").doc(currentShiftKey).get().catch(() => null);
            if (activeTodaySnap && activeTodaySnap.exists) {
                const freshData = activeTodaySnap.data();
                localStorage.setItem('shift_data_gas_' + currentShiftKey, JSON.stringify(freshData));
                applyShiftDataToUI(freshData, true);
            } else {
                resetFormInputsOnly(false);
            }

            applyDutyPermissionToTodayForm(currentShiftKey);
            attachLiveShiftListener(currentShiftKey);
        } catch (err) {
            console.warn("Auto archive error:", err.message);
        } finally {
            isAutoArchivingInProgress = false;
        }
    }
}

function attachLiveShiftListener(dateKey) {
    if (!dateKey) return;
    if (unsubscribeLiveShift && activeWatchedDateKey === dateKey) return;

    if (unsubscribeLiveShift) {
        unsubscribeLiveShift();
        unsubscribeLiveShift = null;
    }
    activeWatchedDateKey = dateKey;

    unsubscribeLiveShift = db.collection("active_shift_gas").doc(dateKey)
        .onSnapshot((docSnapshot) => {
            if (docSnapshot.exists) {
                const remoteData = docSnapshot.data();
                localStorage.setItem('shift_data_gas_' + dateKey, JSON.stringify(remoteData));
                applyShiftDataToUI(remoteData);
            } else if (!isAutoArchivingInProgress) {
                resetFormInputsOnly(false);
            }
        }, (err) => {
            console.warn("Live shift listener error:", err.message);
        });
}

async function refreshTodayReadings() {
    await checkAndRunAutoArchiveAt630();
    const dateKey = getActiveShiftDateKey();
    const dutyShift = getDutyShiftNumberForDate(dateKey);
    document.getElementById('current-shift-date-label').textContent = `تاريخ الوردية النشطة: ${dateKey} • الوجبة المناوبة: وجبة ${dutyShift}`;
    startGeofenceTracking();
    applyDutyPermissionToTodayForm(dateKey);

    const btn = document.getElementById('refresh-today-btn');
    const icon = document.getElementById('refresh-today-icon');
    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('fa-spin');

    try {
        await ensureFirebaseSession();
        let docSnap;
        try {
            docSnap = await db.collection("active_shift_gas").doc(dateKey).get({ source: 'server' });
        } catch (serverErr) {
            docSnap = await db.collection("active_shift_gas").doc(dateKey).get();
        }

        if (docSnap && docSnap.exists) {
            const latestData = docSnap.data();
            localStorage.setItem('shift_data_gas_' + dateKey, JSON.stringify(latestData));
            applyShiftDataToUI(latestData, true);
        } else {
            const cached = localStorage.getItem('shift_data_gas_' + dateKey);
            if (cached) {
                applyShiftDataToUI(JSON.parse(cached), true);
            } else {
                resetFormInputsOnly(false);
            }
        }

        if (unsubscribeLiveShift && activeWatchedDateKey === dateKey) {
            unsubscribeLiveShift();
            unsubscribeLiveShift = null;
            activeWatchedDateKey = null;
        }
        attachLiveShiftListener(dateKey);
    } catch (err) {
        console.warn("Refresh today error:", err.message);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
        if (btn) btn.disabled = false;
    }
}

async function verifyEmployeeSessionFromDB(empObj) {
    if (!empObj) return null;
    if (isFounderUser(empObj)) {
        return empObj;
    }
    if (!empObj.id) return null;

    await ensureFirebaseSession();
    try {
        const docSnap = await db.collection("employees_gas").doc(empObj.id).get();
        if (!docSnap.exists) {
            return { invalid: true, reason: "deleted" };
        }
        const latestData = docSnap.data();
        if (latestData.status !== "approved") {
            return { invalid: true, reason: latestData.status || "not_approved" };
        }
        return { id: docSnap.id, shiftGroup: Number(latestData.shiftGroup || 1), ...latestData };
    } catch (e) {
        console.warn("Verify session error:", e.message);
        return empObj;
    }
}

window.onload = async function() {
    await ensureFirebaseSession();
    attachHeaderBrandingListener();
    attachReadingSheetTemplateListener();
    attachReadingSheetLayoutListener();
    await checkAndRunAutoArchiveAt630();
    attachLiveShiftListener(getActiveShiftDateKey());

    setInterval(() => {
        checkAndRunAutoArchiveAt630();
    }, 15000);

    let savedUser = localStorage.getItem('active_employee_session_gas');
    if (savedUser) {
        let parsedUser = JSON.parse(savedUser);
        const checked = await verifyEmployeeSessionFromDB(parsedUser);

        if (!checked || checked.invalid) {
            localStorage.removeItem('active_employee_session_gas');
            currentEmployee = null;
            renderDashboardPinnedImageUI(currentPinnedHeaderImage);
            switchTab('login-section');
            if (checked && checked.reason === "deleted") {
                alert("⚠️ تم حذف حسابك ولا يمكنك الدخول.");
            } else if (checked && checked.invalid) {
                alert("⚠️ تم إيقاف تفعيل حسابك أو إرجاعه إلى قائمة الانتظار.");
            }
            return;
        }

        currentEmployee = checked;
        localStorage.setItem('active_employee_session_gas', JSON.stringify(currentEmployee));
        checkUserRoleAndRedirect();
    } else {
        renderDashboardPinnedImageUI(currentPinnedHeaderImage);
        switchTab('login-section');
    }
};

async function checkUserRoleAndRedirect() {
    if (!currentEmployee) {
        renderDashboardPinnedImageUI(currentPinnedHeaderImage);
        switchTab('login-section');
        return;
    }

    const checked = await verifyEmployeeSessionFromDB(currentEmployee);
    if (!checked || checked.invalid) {
        localStorage.removeItem('active_employee_session_gas');
        currentEmployee = null;
        renderDashboardPinnedImageUI(currentPinnedHeaderImage);
        switchTab('login-section');
        alert("⚠️ حسابك غير مفعل حالياً أو تم حذفه.");
        return;
    }
    currentEmployee = checked;
    localStorage.setItem('active_employee_session_gas', JSON.stringify(currentEmployee));
    applyAdminLabelsForCurrentUser();
    attachLiveShiftListener(getActiveShiftDateKey());
    startGeofenceTracking();

    const canAccessAdmin = hasAdminPanelAccess(currentEmployee);
    const founderTile = document.getElementById('founder-menu-tile');
    const readingSheetTile = document.getElementById('reading-sheet-menu-tile');

    if (founderTile) {
        founderTile.style.display = canAccessAdmin ? "flex" : "none";
    }
    if (readingSheetTile) {
        readingSheetTile.style.display = canAccessAdmin ? "flex" : "none";
    }

    if (canAccessAdmin) {
        db.collection("employees_gas").get().then(snap => {
            let totalApproved = 0;
            let pendingCount = 0;
            snap.forEach(doc => {
                const data = doc.data();
                if (!isFounderUser(data)) {
                    if (data.status === 'pending') pendingCount++;
                    if (data.status === 'approved') totalApproved++;
                }
            });
            document.getElementById('pending-badge-text').textContent = pendingCount > 0
                ? `(${pendingCount}) طلبات جديدة بانتظار المراجعة | الموظفون المعتمدون: (${totalApproved})`
                : `الموظفون المعتمدون: (${totalApproved}) • لا توجد طلبات معلقة`;
        }).catch(err => console.warn("Admin count warning:", err.message));
    }
    switchTab('dashboard-section');
}

async function handleLogin(e) {
    e.preventDefault();
    const identifier = document.getElementById('login-identifier').value.trim();
    const pass = document.getElementById('login-pass').value.trim();

    await ensureFirebaseSession();

    if (identifier.toLowerCase().includes("@") || identifier.toLowerCase() === FOUNDER_EMAIL.toLowerCase()) {
        if (identifier.toLowerCase() === FOUNDER_EMAIL.toLowerCase()) {
            auth.signInWithEmailAndPassword(identifier, pass)
                .then(res => {
                    currentEmployee = { name: "المهندس مصطفى قيس قاسم", email: res.user.email, isFounder: true };
                    localStorage.setItem('active_employee_session_gas', JSON.stringify(currentEmployee));
                    checkUserRoleAndRedirect();
                })
                .catch(async () => {
                    await ensureFirebaseSession();
                    currentEmployee = { name: "المهندس مصطفى قيس قاسم", email: FOUNDER_EMAIL, isFounder: true };
                    localStorage.setItem('active_employee_session_gas', JSON.stringify(currentEmployee));
                    checkUserRoleAndRedirect();
                });
            return;
        }
    }

    db.collection("employees_gas").get()
        .then(snapshot => {
            let foundEmp = null;
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.phone === identifier && d.password === pass) {
                    foundEmp = { id: doc.id, shiftGroup: Number(d.shiftGroup || 1), ...d };
                }
            });

            if (!foundEmp) {
                localStorage.removeItem('active_employee_session_gas');
                currentEmployee = null;
                alert('❌ خطأ: رقم الهاتف أو كلمة المرور غير صحيحة أو تم حذف الحساب.');
                return;
            }

            if (foundEmp.status === 'pending') {
                localStorage.removeItem('active_employee_session_gas');
                currentEmployee = null;
                alert('⏳ طلب حسابك قيد المراجعة أو تم إيقاف قبوله وبانتظار الموافقة.');
                return;
            }
            if (foundEmp.status === 'rejected') {
                localStorage.removeItem('active_employee_session_gas');
                currentEmployee = null;
                alert('❌ عذراً، تم رفض طلب انضمامك.');
                return;
            }

            currentEmployee = foundEmp;
            localStorage.setItem('active_employee_session_gas', JSON.stringify(currentEmployee));
            checkUserRoleAndRedirect();
        })
        .catch(err => {
            alert('خطأ في الاتصال: ' + err.message);
        });
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const title = document.getElementById('reg-title').value.trim();
    const shiftGroup = Number(document.getElementById('reg-shift').value || 1);
    const phone = document.getElementById('reg-phone').value.trim();
    const pass = document.getElementById('reg-pass').value.trim();
    const fileInput = document.getElementById('reg-id-image');
    const submitBtn = document.getElementById('reg-submit-btn');

    if (name.split(' ').length < 3) {
        alert('⚠️ يرجى إدخال الاسم الكامل بدقة.');
        return;
    }

    const file = fileInput.files[0];
    if (!file) {
        alert('⚠️ يرجى إرفاق صورة الهوية!');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ جاري إرسال الطلب...';

    await ensureFirebaseSession();

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 700;
            const MAX_HEIGHT = 700;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.65);

            const newEmployee = {
                name: name,
                title: title,
                shiftGroup: shiftGroup,
                staffCategory: 'shift',
                isGovernorateStaff: false,
                phone: phone,
                password: pass,
                idImage: compressedDataUrl,
                responsibility: '',
                status: 'pending',
                createdAt: new Date().toISOString()
            };

            db.collection("employees_gas").add(newEmployee)
                .then(() => {
                    document.getElementById('register-form-box').style.display = 'none';
                    document.getElementById('register-success-box').style.display = 'flex';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'إرسال طلب الانضمام';
                })
                .catch(err => {
                    alert('❌ خطأ في إرسال الطلب: ' + err.message);
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'إرسال طلب الانضمام';
                });
        };
    };
    reader.readAsDataURL(file);
}

function resetRegisterForm() {
    document.getElementById('register-form-box').reset();
    document.getElementById('register-form-box').style.display = 'flex';
    document.getElementById('register-success-box').style.display = 'none';
}

function logout() {
    if (geoWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoWatchId);
        geoWatchId = null;
    }
    localStorage.removeItem('active_employee_session_gas');
    currentEmployee = null;
    renderDashboardPinnedImageUI(currentPinnedHeaderImage);
    switchTab('login-section');
}

function toggleDropdown() { document.getElementById('dropdownMenu').classList.toggle('show'); }
function toggleDarkMode() { document.body.classList.toggle('dark-mode'); toggleDropdown(); }
function togglePass(id, el) {
    const input = document.getElementById(id);
    input.type = input.type === "password" ? "text" : "password";
    el.textContent = input.type === "password" ? "إظهار" : "إخفاء";
}
function switchTab(id) {
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function toggleEmpDotsMenu(event, menuId) {
    event.stopPropagation();
    const targetMenu = document.getElementById(menuId);
    const wasOpen = targetMenu && targetMenu.classList.contains("show");
    document.querySelectorAll(".emp-menu-list.show").forEach(m => m.classList.remove("show"));
    if (targetMenu && !wasOpen) {
        targetMenu.classList.add("show");
    }
}

function escapeJsString(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function selectFounderTab(tabKey, btnEl = null) {
    activeFounderTab = tabKey;
    document.querySelectorAll('.founder-tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = btnEl || document.getElementById(`ftab-${tabKey}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    updateFounderTabHeaderMeta();
    renderFounderEmployeesByActiveTab();
}

function updateFounderTabHeaderMeta() {
    const titleEl = document.getElementById('founder-active-tab-title');
    const descEl = document.getElementById('founder-active-tab-desc');
    if (!titleEl || !descEl) return;

    const metaMap = {
        'pending': {
            title: 'طلبات الموظفين الجديدة',
            desc: 'الطلبات الواردة بانتظار الموافقة؛ عند الضغط على (موافق) ينتقل الموظف تلقائياً إلى جميع الموظفين ويفرغ الحقل من الطلب المقبول.'
        },
        'all': {
            title: 'جميع الموظفين المعتمدين',
            desc: 'كافة حسابات الموظفين المقبولين؛ يمكنك نقل أي موظف إلى وجبة معينة أو إلى كادر المحافظات أو إسناد/إزالة المسؤوليات.'
        },
        'shift-1': {
            title: 'موظفو الوجبة الأولى (وجبة 1)',
            desc: 'الموظفون الموزعون على الوجبة 1؛ يمكنك نقل أي موظف إلى وجبة أخرى أو إلى كادر المحافظات.'
        },
        'shift-2': {
            title: 'موظفو الوجبة الثانية (وجبة 2)',
            desc: 'الموظفون الموزعون على الوجبة 2؛ يمكنك نقل أي موظف إلى وجبة أخرى أو إلى كادر المحافظات.'
        },
        'shift-3': {
            title: 'موظفو الوجبة الثالثة (وجبة 3)',
            desc: 'الموظفون الموزعون على الوجبة 3؛ يمكنك نقل أي موظف إلى وجبة أخرى أو إلى كادر المحافظات.'
        },
        'shift-4': {
            title: 'موظفو الوجبة الرابعة (وجبة 4)',
            desc: 'الموظفون الموزعون على الوجبة 4؛ يمكنك نقل أي موظف إلى وجبة أخرى أو إلى كادر المحافظات.'
        },
        'gov-staff': {
            title: 'كادر المحافظات',
            desc: 'الموظفون ضمن كادر المحافظات؛ يُسمح لهم بإضافة أو تعديل القراءات فقط عندما يكونون داخل نطاق موقع العمل (800 متر).'
        }
    };

    const info = metaMap[activeFounderTab] || metaMap['pending'];
    titleEl.textContent = info.title;
    descEl.textContent = info.desc;
}

function updateFounderTabCounts() {
    const pendingList = founderEmployeesCache.filter(u => u.status === 'pending');
    const approvedList = founderEmployeesCache.filter(u => u.status === 'approved');
    const govList = approvedList.filter(u => isGovernorateStaff(u));

    const cPending = document.getElementById('count-pending');
    const cAll = document.getElementById('count-all');
    const cGov = document.getElementById('count-gov-staff');
    if (cPending) cPending.textContent = pendingList.length;
    if (cAll) cAll.textContent = approvedList.length;
    if (cGov) cGov.textContent = govList.length;

    [1, 2, 3, 4].forEach(num => {
        const cShift = document.getElementById(`count-shift-${num}`);
        if (cShift) {
            cShift.textContent = approvedList.filter(u => !isGovernorateStaff(u) && Number(u.shiftGroup || 1) === num).length;
        }
    });
}

function renderFounderEmployeesByActiveTab() {
    const container = document.getElementById('founder-users-container');
    if (!container) return;

    updateFounderTabCounts();
    updateFounderTabHeaderMeta();

    const approvedList = founderEmployeesCache.filter(u => u.status === 'approved');
    let filteredUsers = [];

    if (activeFounderTab === 'pending') {
        filteredUsers = founderEmployeesCache.filter(u => u.status === 'pending');
    } else if (activeFounderTab === 'all') {
        filteredUsers = approvedList;
    } else if (activeFounderTab === 'gov-staff') {
        filteredUsers = approvedList.filter(u => isGovernorateStaff(u));
    } else if (activeFounderTab.startsWith('shift-')) {
        const targetShift = Number(activeFounderTab.replace('shift-', ''));
        filteredUsers = approvedList.filter(u => !isGovernorateStaff(u) && Number(u.shiftGroup || 1) === targetShift);
    }

    if (filteredUsers.length === 0) {
        const emptyMessages = {
            'pending': 'حقل طلبات الموظفين فارغ حالياً — لا توجد طلبات جديدة بانتظار الموافقة.',
            'all': 'لا يوجد موظفون معتمدون في قائمة جميع الموظفين حتى الآن.',
            'shift-1': 'لا يوجد موظفون مسجلون في الوجبة 1 حالياً.',
            'shift-2': 'لا يوجد موظفون مسجلون في الوجبة 2 حالياً.',
            'shift-3': 'لا يوجد موظفون مسجلون في الوجبة 3 حالياً.',
            'shift-4': 'لا يوجد موظفون مسجلون في الوجبة 4 حالياً.',
            'gov-staff': 'لا يوجد موظفون ضمن كادر المحافظات حالياً.'
        };
        container.innerHTML = `
            <div style="text-align:center; padding: 34px 16px; background:#f8fafc; border:1.5px dashed #cbd5e1; border-radius:16px; color:#64748b; font-size:13px; font-weight:700; font-family:'Cairo',sans-serif;">
                <i class="fa-solid fa-folder-open" style="font-size:28px; color:#94a3b8; display:block; margin-bottom:10px;"></i>
                ${emptyMessages[activeFounderTab] || 'لا توجد سجلات في هذا الحقل.'}
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    filteredUsers.forEach((u, idx) => {
        const isPending = u.status === 'pending';
        const isApproved = u.status === 'approved';
        const isRejected = u.status === 'rejected';
        const isGov = isGovernorateStaff(u);

        const statusColor = isApproved ? '#15803d' : (isPending ? '#d97706' : '#dc2626');
        const statusLabel = isApproved ? 'مقبول ومفعل' : (isPending ? 'طلب جديد بانتظار القرار' : 'مرفوض');
        const borderColor = isGov ? '#7e22ce' : (isApproved ? '#22c55e' : (isPending ? '#f59e0b' : '#ef4444'));
        const menuId = `emp-dots-menu-${activeFounderTab}-${idx}`;
        const safeName = escapeJsString(u.name);
        const shiftNum = Number(u.shiftGroup || 1);

        container.innerHTML += `
            <div class="archive-card" style="border-right-color: ${borderColor}; cursor: default;">
                <div class="emp-card-header">
                    <div>
                        <h4><i class="fa-solid fa-user-tie" style="color:${borderColor}; margin-left:6px;"></i> ${u.name}</h4>
                        <div>
                            ${isGov
                                ? `<span class="gov-tag"><i class="fa-solid fa-map-location-dot"></i> كادر المحافظات</span>`
                                : `<span class="shift-tag"><i class="fa-solid fa-clock"></i> وجبة ${shiftNum}</span>`
                            }
                            ${u.responsibility ? `<span class="role-badge"><i class="fa-solid fa-award"></i> ${u.responsibility}</span>` : ''}
                        </div>
                    </div>
                    <div class="emp-dots-wrapper">
                        <button type="button" class="emp-dots-btn" title="خيارات الموظف" onclick="toggleEmpDotsMenu(event, '${menuId}')">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>
                        <div class="emp-menu-list" id="${menuId}">
                            ${isApproved ? `
                                <button type="button" class="emp-menu-item" style="color:#0284c7;" onclick="openShiftGroupModal('${u.id}')">
                                    <i class="fa-solid fa-right-left"></i> نقل / تحديد الوجبة
                                </button>
                                ${!isGov ? `
                                    <button type="button" class="emp-menu-item" style="color:#7e22ce;" onclick="quickMoveToGovernorateStaff('${u.id}')">
                                        <i class="fa-solid fa-map-location-dot"></i> نقل إلى كادر المحافظات
                                    </button>
                                ` : ''}
                            ` : ''}
                            <button type="button" class="emp-menu-item" style="color:#0d9488;" onclick="openResponsibilityModal('${u.id}')">
                                <i class="fa-solid fa-user-shield"></i> إضافة مسؤولية
                            </button>
                            ${u.idImage ? `
                                <button type="button" class="emp-menu-item" style="color:#0284c7;" onclick="viewIdImage('${u.idImage}')">
                                    <i class="fa-solid fa-id-card"></i> عرض الهوية
                                </button>
                            ` : ''}
                            <div class="emp-menu-divider"></div>
                            ${!isApproved ? `
                                <button type="button" class="emp-menu-item" style="color:#16a34a;" onclick="updateEmpStatus('${u.id}', 'approved')">
                                    <i class="fa-solid fa-check"></i> موافق (نقل للموظفين)
                                </button>
                            ` : `
                                <button type="button" class="emp-menu-item" style="color:#475569;" onclick="updateEmpStatus('${u.id}', 'pending')">
                                    <i class="fa-solid fa-rotate-left"></i> إرجاع للطلبات
                                </button>
                            `}
                            ${!isRejected ? `
                                <button type="button" class="emp-menu-item" style="color:#ea580c;" onclick="updateEmpStatus('${u.id}', 'rejected')">
                                    <i class="fa-solid fa-ban"></i> رفض
                                </button>
                            ` : `
                                <button type="button" class="emp-menu-item" style="color:#475569;" onclick="updateEmpStatus('${u.id}', 'pending')">
                                    <i class="fa-solid fa-rotate-left"></i> إعادة للمراجعة
                                </button>
                            `}
                            <div class="emp-menu-divider"></div>
                            <button type="button" class="emp-menu-item danger" onclick="deleteEmployee('${u.id}', '${safeName}')">
                                <i class="fa-solid fa-trash"></i> حذف الطلب
                            </button>
                        </div>
                    </div>
                </div>
                <p style="margin-top:6px;"><strong>العنوان الوظيفي:</strong> ${u.title || '-'}</p>
                <p><strong>رقم الهاتف:</strong> <span dir="ltr">${u.phone}</span></p>
                <p><strong>الحالة:</strong> <span style="color: ${statusColor}; font-weight: 800;">${statusLabel}</span></p>
            </div>
        `;
    });
}

async function refreshFounderData() {
    const container = document.getElementById('founder-users-container');
    container.innerHTML = '<p style="text-align: center; color: #64748b; font-size: 13px;">جاري جلب طلبات وحسابات الموظفين...</p>';

    await ensureFirebaseSession();

    try {
        const snapshot = await db.collection("employees_gas").get();
        founderEmployeesCache = [];

        snapshot.forEach(doc => {
            const u = doc.data();
            if (isFounderUser(u)) {
                return;
            }
            founderEmployeesCache.push({ id: doc.id, shiftGroup: Number(u.shiftGroup || 1), ...u });
        });

        renderFounderEmployeesByActiveTab();
    } catch (err) {
        container.innerHTML = `<p style="text-align: center; color: #ef4444;">خطأ في جلب السجلات: ${err.message}</p>`;
    }
}

async function openFounderPanel() {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ هذه اللوحة متاحة فقط للمؤسس ومسؤول شعبة GTU.');
        return;
    }
    applyAdminLabelsForCurrentUser();
    switchTab('founder-panel-section');
    selectFounderTab(activeFounderTab || 'pending');
    await refreshFounderData();
}

function openShiftGroupModal(empId) {
    document.querySelectorAll(".emp-menu-list.show").forEach(m => m.classList.remove("show"));
    const emp = founderEmployeesCache.find(e => e.id === empId);
    if (!emp) return;

    selectedEmployeeForShift = emp;
    const isGov = isGovernorateStaff(emp);
    const currentShift = Number(emp.shiftGroup || 1);
    document.getElementById('shift-emp-subtitle').textContent = isGov
        ? `الموظف: ${emp.name} (الحالة الحالية: كادر المحافظات)`
        : `الموظف: ${emp.name} (الوجبة الحالية: وجبة ${currentShift})`;

    [1, 2, 3, 4].forEach(num => {
        const btn = document.getElementById(`shift-opt-${num}`);
        if (btn) btn.classList.toggle('selected', !isGov && currentShift === num);
    });
    const govBtn = document.getElementById('shift-opt-gov');
    if (govBtn) govBtn.classList.toggle('selected', isGov);

    document.getElementById('shiftGroupModal').style.display = 'flex';
}

function closeShiftGroupModal() {
    selectedEmployeeForShift = null;
    document.getElementById('shiftGroupModal').style.display = 'none';
}

async function assignEmployeeShiftGroup(shiftNum) {
    if (!selectedEmployeeForShift) return;
    const emp = selectedEmployeeForShift;
    const targetShift = Number(shiftNum);

    await ensureFirebaseSession();
    db.collection("employees_gas").doc(emp.id).update({
        shiftGroup: targetShift,
        staffCategory: 'shift',
        isGovernorateStaff: false
    })
        .then(() => {
            emp.shiftGroup = targetShift;
            emp.staffCategory = 'shift';
            emp.isGovernorateStaff = false;
            closeShiftGroupModal();
            renderFounderEmployeesByActiveTab();
        })
        .catch(err => alert('خطأ في حفظ الوجبة: ' + err.message));
}

async function assignEmployeeToGovernorateStaff() {
    if (!selectedEmployeeForShift) return;
    const emp = selectedEmployeeForShift;

    await ensureFirebaseSession();
    db.collection("employees_gas").doc(emp.id).update({
        staffCategory: 'governorate',
        isGovernorateStaff: true
    })
        .then(() => {
            emp.staffCategory = 'governorate';
            emp.isGovernorateStaff = true;
            closeShiftGroupModal();
            renderFounderEmployeesByActiveTab();
        })
        .catch(err => alert('خطأ في النقل إلى كادر المحافظات: ' + err.message));
}

async function quickMoveToGovernorateStaff(empId) {
    document.querySelectorAll(".emp-menu-list.show").forEach(m => m.classList.remove("show"));
    const emp = founderEmployeesCache.find(e => e.id === empId);
    if (!emp) return;

    await ensureFirebaseSession();
    db.collection("employees_gas").doc(emp.id).update({
        staffCategory: 'governorate',
        isGovernorateStaff: true
    })
        .then(() => {
            emp.staffCategory = 'governorate';
            emp.isGovernorateStaff = true;
            renderFounderEmployeesByActiveTab();
        })
        .catch(err => alert('خطأ في النقل إلى كادر المحافظات: ' + err.message));
}

function openResponsibilityModal(empId) {
    document.querySelectorAll(".emp-menu-list.show").forEach(m => m.classList.remove("show"));
    const emp = founderEmployeesCache.find(e => e.id === empId);
    if (!emp) return;

    selectedEmployeeForRole = emp;
    document.getElementById('resp-emp-subtitle').textContent = `الموظف: ${emp.name}${emp.responsibility ? ` (المسؤولية الحالية: ${emp.responsibility})` : ''}`;

    const existingGtuHead = founderEmployeesCache.find(e => e.id !== emp.id && e.responsibility === GTU_HEAD_ROLE);
    const noteEl = document.getElementById('resp-current-holder-note');
    if (existingGtuHead) {
        noteEl.style.display = 'block';
        noteEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> رتبة (${GTU_HEAD_ROLE}) مسندة حالياً إلى: <strong>${existingGtuHead.name}</strong>. إسنادها لموظف آخر ينقل الرتبة إليه ويزيلها عن المسؤول الحالي.`;
    } else {
        noteEl.style.display = 'none';
        noteEl.innerHTML = '';
    }

    RESPONSIBILITY_ROLES.forEach((role, idx) => {
        const btn = document.getElementById(`role-opt-${idx + 1}`);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.classList.toggle('selected', emp.responsibility === role);
        }
    });

    document.getElementById('clear-role-btn').style.display = emp.responsibility ? 'flex' : 'none';
    document.getElementById('responsibilityModal').style.display = 'flex';
}

function closeResponsibilityModal() {
    selectedEmployeeForRole = null;
    document.getElementById('responsibilityModal').style.display = 'none';
}

async function assignEmployeeRole(newRole) {
    if (!selectedEmployeeForRole) return;
    const emp = selectedEmployeeForRole;
    const isCurrentUserGtuHead = isGtuHeadUser(currentEmployee) && !isFounderUser(currentEmployee);

    if (newRole === GTU_HEAD_ROLE) {
        const existingGtuHead = founderEmployeesCache.find(e => e.id !== emp.id && e.responsibility === GTU_HEAD_ROLE);

        if (existingGtuHead && isCurrentUserGtuHead) {
            const proceedSwap = confirm(
                `سوف تقوم بتبديل بإعطاء رتبة (${GTU_HEAD_ROLE}) إلى الموظف (${emp.name}) بدلاً من (${existingGtuHead.name}).\nهل تريد المتابعة؟`
            );
            if (!proceedSwap) return;

            const firstConfirm = confirm(
                `هل أنت متأكد من إعطاء صلاحية مسؤول شعبة (${GTU_HEAD_ROLE}) إلى (${emp.name})؟ (تأكيد 1 من 2)`
            );
            if (!firstConfirm) return;

            const secondConfirm = confirm(
                `هل أنت متأكد من إعطاء صلاحية مسؤول شعبة (${GTU_HEAD_ROLE}) إلى (${emp.name})؟ (تأكيد 2 من 2)`
            );
            if (!secondConfirm) return;

            const finalIrreversibleConfirm = confirm(
                `⚠️ سوف تقوم بنقل رتبة (${GTU_HEAD_ROLE}) إلى (${emp.name}) ولا يمكن التراجع بعد ذلك.\nهل توافق على النقل النهائي؟`
            );
            if (!finalIrreversibleConfirm) return;

            await ensureFirebaseSession();
            try {
                const batch = db.batch();
                batch.update(db.collection("employees_gas").doc(emp.id), { responsibility: GTU_HEAD_ROLE });
                batch.update(db.collection("employees_gas").doc(existingGtuHead.id), { responsibility: '' });
                await batch.commit();

                emp.responsibility = GTU_HEAD_ROLE;
                existingGtuHead.responsibility = '';

                if (currentEmployee && currentEmployee.id === existingGtuHead.id) {
                    currentEmployee.responsibility = '';
                    localStorage.setItem('active_employee_session_gas', JSON.stringify(currentEmployee));
                }

                closeResponsibilityModal();
                alert(`✅ تم نقل رتبة (${GTU_HEAD_ROLE}) بنجاح إلى (${emp.name}).`);
                await checkUserRoleAndRedirect();
                return;
            } catch (err) {
                alert('خطأ في نقل رتبة مسؤول الشعبة: ' + err.message);
                return;
            }
        }

        if (existingGtuHead) {
            alert(`⚠️ لا يمكن إسناد رتبة (${GTU_HEAD_ROLE}) لأكثر من موظف في نفس الوقت.\nالمسؤول الحالي هو: (${existingGtuHead.name}).\nيرجى تخفيضه أو إزالة مسؤوليته أولاً.`);
            return;
        }
    }

    await ensureFirebaseSession();
    db.collection("employees_gas").doc(emp.id).update({ responsibility: newRole })
        .then(async () => {
            emp.responsibility = newRole;
            if (currentEmployee && currentEmployee.id === emp.id) {
                currentEmployee.responsibility = newRole;
                localStorage.setItem('active_employee_session_gas', JSON.stringify(currentEmployee));
            }
            closeResponsibilityModal();
            renderFounderEmployeesByActiveTab();
        })
        .catch(err => alert('خطأ في حفظ المسؤولية: ' + err.message));
}

async function updateEmpStatus(docId, newStatus) {
    document.querySelectorAll(".emp-menu-list.show").forEach(m => m.classList.remove("show"));
    await ensureFirebaseSession();
    db.collection("employees_gas").doc(docId).update({ status: newStatus })
        .then(() => {
            const target = founderEmployeesCache.find(u => u.id === docId);
            if (target) target.status = newStatus;
            renderFounderEmployeesByActiveTab();
        })
        .catch(err => alert('خطأ: ' + err.message));
}

async function deleteEmployee(docId, empName) {
    document.querySelectorAll(".emp-menu-list.show").forEach(m => m.classList.remove("show"));
    if (!confirm(`هل أنت متأكد من حذف طلب/حساب (${empName}) نهائياً؟`)) return;
    await ensureFirebaseSession();
    db.collection("employees_gas").doc(docId).delete()
        .then(() => {
            founderEmployeesCache = founderEmployeesCache.filter(u => u.id !== docId);
            renderFounderEmployeesByActiveTab();
        })
        .catch(err => alert('خطأ في الحذف: ' + err.message));
}

function viewIdImage(base64) {
    document.querySelectorAll(".emp-menu-list.show").forEach(m => m.classList.remove("show"));
    document.getElementById('modal-id-img').src = base64;
    document.getElementById('idImageModal').style.display = 'flex';
}
function closeIdModal() {
    document.getElementById('idImageModal').style.display = 'none';
}

async function openTodayForm() {
    await checkAndRunAutoArchiveAt630();
    const dateKey = getActiveShiftDateKey();
    const dutyShift = getDutyShiftNumberForDate(dateKey);
    document.getElementById('current-shift-date-label').textContent = `تاريخ الوردية النشطة: ${dateKey} • الوجبة المناوبة: وجبة ${dutyShift}`;
    startGeofenceTracking();
    applyDutyPermissionToTodayForm(dateKey);
    switchTab('today-form-section');

    let savedTodayData = localStorage.getItem('shift_data_gas_' + dateKey);
    if (savedTodayData) {
        try {
            let parsed = JSON.parse(savedTodayData);
            applyShiftDataToUI(parsed);
        } catch(e) {}
    } else {
        resetFormInputsOnly(false);
    }

    await ensureFirebaseSession();
    attachLiveShiftListener(dateKey);
}

const hours = ["7:00", "9:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00", "23:00", "1:00", "3:00", "5:00"];
const container = document.getElementById('rowsContainer');
container.innerHTML = '';
hours.forEach((hour, index) => {
    const row = document.createElement('div');
    row.className = 'row-item';
    row.id = `row_item_${index}`;
    row.innerHTML = `
        <div class="time-label">${hour}</div>
        <input type="number" id="grid_${index}" placeholder="Grid" oninput="autoSaveToday()">
        <input type="number" id="strat_${index}" placeholder="Strat" oninput="autoSaveToday()">
        <input type="number" id="flow_${index}" placeholder="Flow" oninput="checkValue(${index}); autoSaveToday();">
    `;
    container.appendChild(row);
});

function setQutryStatus(status, shouldSave = true) {
    const dateKey = getActiveShiftDateKey();
    if (shouldSave && !isUserAllowedToEnterReadings(dateKey)) return;
    qutryState = status;
    document.getElementById('qutry_off').className = status === 'off' ? 'status-btn active-off' : 'status-btn';
    document.getElementById('qutry_on').className = status === 'on' ? 'status-btn active-on' : 'status-btn';
    if (shouldSave) autoSaveToday();
}

function setSolarStatus(solar, status, shouldSave = true) {
    const dateKey = getActiveShiftDateKey();
    if (shouldSave && !isUserAllowedToEnterReadings(dateKey)) return;
    if (solar === 'A') {
        solarAState = status;
        document.getElementById('solarA_off').className = status === 'off' ? 'status-btn active-off' : 'status-btn';
        document.getElementById('solarA_on').className = status === 'on' ? 'status-btn active-on' : 'status-btn';
        document.getElementById('solarA_pressures').className = status === 'on' ? 'pressures-row show' : 'pressures-row';
    } else {
        solarBState = status;
        document.getElementById('solarB_off').className = status === 'off' ? 'status-btn active-off' : 'status-btn';
        document.getElementById('solarB_on').className = status === 'on' ? 'status-btn active-on' : 'status-btn';
        document.getElementById('solarB_pressures').className = status === 'on' ? 'pressures-row show' : 'pressures-row';
    }
    if (shouldSave) autoSaveToday();
}

function checkValue(index) {
    const flowVal = parseFloat(document.getElementById(`flow_${index}`).value);
    const rowItem = document.getElementById(`row_item_${index}`);
    if (!isNaN(flowVal) && flowVal >= 50000) {
        rowItem.classList.add('high-value');
    } else {
        rowItem.classList.remove('high-value');
    }
    calculate();
}

function calculate() {
    let sum = 0; let filledCount = 0;
    for (let i = 0; i < hours.length; i++) {
        const valStr = document.getElementById(`flow_${i}`).value;
        if (valStr !== '' && !isNaN(valStr)) {
            sum += parseFloat(valStr);
            filledCount++;
        }
    }
    const box1 = document.getElementById('box1');
    const box2 = document.getElementById('box2');
    if (filledCount === hours.length) {
        const result1 = sum * 2;
        const result2 = result1 * 37.226;
        document.getElementById('finalResult1').value = formatNumber(result1);
        document.getElementById('finalResult2').value = formatNumber(result2);
        box1.classList.add('active-result');
        box2.classList.add('active-result');
    } else {
        document.getElementById('finalResult1').value = '-';
        document.getElementById('finalResult2').value = '-';
        box1.classList.remove('active-result');
        box2.classList.remove('active-result');
    }
}

function formatNumber(num) {
    return Number.isInteger(num) ? num.toLocaleString('en-US') : num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function collectCurrentFormData() {
    const dateKey = getActiveShiftDateKey();
    const notesEl = document.getElementById('shiftNotes');
    return {
        date: dateKey,
        dutyShift: getDutyShiftNumberForDate(dateKey),
        recordedBy: currentEmployee ? currentEmployee.name : 'غير معروف',
        updatedBy: currentEmployee ? currentEmployee.name : 'غير معروف',
        updatedAt: new Date().toISOString(),
        grids: hours.map((h, i) => document.getElementById(`grid_${i}`).value),
        strats: hours.map((h, i) => document.getElementById(`strat_${i}`).value),
        flows: hours.map((h, i) => document.getElementById(`flow_${i}`).value),
        qutry: qutryState,
        national: document.getElementById('nationalLine').value,
        iranian: document.getElementById('iranianLine').value,
        solarA: { state: solarAState, suc: document.getElementById('solarA_suc').value, dis: document.getElementById('solarA_dis').value },
        solarB: { state: solarBState, suc: document.getElementById('solarB_suc').value, dis: document.getElementById('solarB_dis').value },
        notes: notesEl ? notesEl.value : '',
        total: document.getElementById('finalResult1').value,
        m3day: document.getElementById('finalResult2').value
    };
}

async function flushLiveShiftToFirestore(dateKey, data) {
    await ensureFirebaseSession();
    try {
        await db.collection("active_shift_gas").doc(dateKey).set(data, { merge: true });
    } catch (err) {
        console.warn("Live sync save warning:", err.message);
    }
}

function autoSaveToday() {
    if (isApplyingRemoteUpdate || isAutoArchivingInProgress) return;
    const dateKey = getActiveShiftDateKey();
    if (!isUserAllowedToEnterReadings(dateKey)) return;

    const data = collectCurrentFormData();
    localStorage.setItem('shift_data_gas_' + dateKey, JSON.stringify(data));
    attachLiveShiftListener(dateKey);

    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        flushLiveShiftToFirestore(dateKey, data);
    }, 40);
}

function applyShiftDataToUI(data, forceSyncFocused = false) {
    if (!data) return;
    isApplyingRemoteUpdate = true;

    const activeEl = forceSyncFocused ? null : document.activeElement;
    const grids = Array.isArray(data.grids) ? data.grids : [];
    const strats = Array.isArray(data.strats) ? data.strats : [];
    const flows = Array.isArray(data.flows) ? data.flows : [];

    hours.forEach((h, i) => {
        const gridInput = document.getElementById(`grid_${i}`);
        const stratInput = document.getElementById(`strat_${i}`);
        const flowInput = document.getElementById(`flow_${i}`);

        const nextGrid = grids[i] || '';
        const nextStrat = strats[i] || '';
        const nextFlow = flows[i] || '';

        if (activeEl !== gridInput && gridInput.value !== nextGrid) {
            gridInput.value = nextGrid;
        }
        if (activeEl !== stratInput && stratInput.value !== nextStrat) {
            stratInput.value = nextStrat;
        }
        if (activeEl !== flowInput && flowInput.value !== nextFlow) {
            flowInput.value = nextFlow;
        }
        checkValue(i);
    });

    setQutryStatus(data.qutry || 'off', false);

    const natInput = document.getElementById('nationalLine');
    const iranInput = document.getElementById('iranianLine');
    if (activeEl !== natInput && natInput.value !== (data.national || '')) {
        natInput.value = data.national || '';
    }
    if (activeEl !== iranInput && iranInput.value !== (data.iranian || '')) {
        iranInput.value = data.iranian || '';
    }

    if (data.solarA) {
        setSolarStatus('A', data.solarA.state || 'off', false);
        const sucA = document.getElementById('solarA_suc');
        const disA = document.getElementById('solarA_dis');
        if (activeEl !== sucA && sucA.value !== (data.solarA.suc || '')) {
            sucA.value = data.solarA.suc || '';
        }
        if (activeEl !== disA && disA.value !== (data.solarA.dis || '')) {
            disA.value = data.solarA.dis || '';
        }
    }

    if (data.solarB) {
        setSolarStatus('B', data.solarB.state || 'off', false);
        const sucB = document.getElementById('solarB_suc');
        const disB = document.getElementById('solarB_dis');
        if (activeEl !== sucB && sucB.value !== (data.solarB.suc || '')) {
            sucB.value = data.solarB.suc || '';
        }
        if (activeEl !== disB && disB.value !== (data.solarB.dis || '')) {
            disB.value = data.solarB.dis || '';
        }
    }

    const notesEl = document.getElementById('shiftNotes');
    if (notesEl && activeEl !== notesEl && notesEl.value !== (data.notes || '')) {
        notesEl.value = data.notes || '';
    }

    calculate();
    isApplyingRemoteUpdate = false;
}

function resetFormInputsOnly(shouldSave = false) {
    isApplyingRemoteUpdate = true;
    hours.forEach((h, i) => {
        document.getElementById(`grid_${i}`).value = '';
        document.getElementById(`strat_${i}`).value = '';
        document.getElementById(`flow_${i}`).value = '';
        document.getElementById(`row_item_${i}`).classList.remove('high-value');
    });
    document.getElementById('nationalLine').value = '';
    document.getElementById('iranianLine').value = '';
    document.getElementById('solarA_suc').value = '';
    document.getElementById('solarA_dis').value = '';
    document.getElementById('solarB_suc').value = '';
    document.getElementById('solarB_dis').value = '';
    const notesEl = document.getElementById('shiftNotes');
    if (notesEl) notesEl.value = '';
    setQutryStatus('off', false);
    setSolarStatus('A', 'off', false);
    setSolarStatus('B', 'off', false);
    calculate();
    isApplyingRemoteUpdate = false;
    if (shouldSave) autoSaveToday();
}

function parseNumericMetric(val) {
    if (val === undefined || val === null) return null;
    const cleaned = String(val).replace(/,/g, '').trim();
    if (!cleaned || cleaned === '-') return null;
    const num = Number(cleaned);
    return isNaN(num) ? null : num;
}

function extractMonthKeyFromDateStr(dateStr) {
    const raw = String(dateStr || '').trim();
    // YYYY-MM-DD or YYYY/MM/DD
    let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) {
        return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
    }
    // DD-MM-YYYY or DD/MM/YYYY
    m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) {
        return `${m[3]}-${String(m[2]).padStart(2, '0')}`;
    }
    return 'غير-محدد';
}

function getSortableDateTimestamp(dateStr) {
    const raw = String(dateStr || '').trim();
    let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) {
        return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) {
        return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    }
    return 0;
}

function formatMonthTitleArabic(monthKey) {
    if (!monthKey || monthKey === 'غير-محدد') return 'أيام غير محددة الشهر';
    const parts = monthKey.split('-');
    if (parts.length !== 2) return monthKey;
    const year = parts[0];
    const mm = parts[1].padStart(2, '0');
    const monthName = ARABIC_MONTH_NAMES[mm] || `شهر ${mm}`;
    return `${monthName} ${year}`;
}

function computeMonthCumulativeStats(recordsList) {
    let totalSum = 0;
    let m3daySum = 0;
    let completedDaysCount = 0;

    (recordsList || []).forEach(rec => {
        const tVal = parseNumericMetric(rec.total);
        const mVal = parseNumericMetric(rec.m3day);
        if (tVal !== null) totalSum += tVal;
        if (mVal !== null) m3daySum += mVal;
        if (tVal !== null || mVal !== null) completedDaysCount++;
    });

    return {
        daysCount: (recordsList || []).length,
        completedDaysCount,
        totalSum,
        m3daySum,
        formattedTotal: formatNumber(totalSum),
        formattedM3Day: formatNumber(m3daySum)
    };
}

function buildArchiveDayCardElement(d) {
    const card = document.createElement('div');
    card.className = 'archive-card';
    card.innerHTML = `
        <h4><i class="fa-solid fa-calendar-check" style="color:#0d9488; margin-left:6px;"></i> تاريخ الوردية: ${d.date}</h4>
        <p><strong>TOTAL:</strong> ${d.total || '-'}</p>
        <p><strong>M³/DAY:</strong> ${d.m3day || '-'}</p>
        ${d.recordedBy ? `<p style="font-size:11px; color:#64748b;">بواسطة: ${d.recordedBy}</p>` : ''}
    `;
    card.onclick = () => showArchiveDetailModal(d);
    return card;
}

function openCompletedMonthFolder(monthKey) {
    selectedCompletedMonthKey = monthKey;
    renderArchiveSectionContent();
}

function backToArchiveOverview() {
    selectedCompletedMonthKey = null;
    renderArchiveSectionContent();
}

function renderArchiveSectionContent() {
    const container = document.getElementById('archive-records-container');
    if (!container) return;

    if (!archiveRecordsCache || archiveRecordsCache.length === 0) {
        selectedCompletedMonthKey = null;
        container.innerHTML = '<p style="text-align: center; color: #64748b; font-size: 13px;">لا توجد سجلات محفوظة حتى الآن.</p>';
        return;
    }

    const activeMonthKey = getActiveShiftDateKey().slice(0, 7);
    const currentMonthRecords = [];
    const completedMonthsMap = new Map();

    archiveRecordsCache.forEach(rec => {
        const mKey = extractMonthKeyFromDateStr(rec.date);
        if (mKey === activeMonthKey) {
            currentMonthRecords.push(rec);
        } else {
            if (!completedMonthsMap.has(mKey)) {
                completedMonthsMap.set(mKey, []);
            }
            completedMonthsMap.get(mKey).push(rec);
        }
    });

    const sortedCompletedMonthKeys = Array.from(completedMonthsMap.keys()).sort((a, b) => b.localeCompare(a));

    // إذا فتح المستخدم ملف شهر مكتمل معين
    if (selectedCompletedMonthKey) {
        const monthDays = completedMonthsMap.get(selectedCompletedMonthKey) || [];
        const stats = computeMonthCumulativeStats(monthDays);
        const monthTitle = formatMonthTitleArabic(selectedCompletedMonthKey);

        container.innerHTML = '';

        const topBar = document.createElement('div');
        topBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;';
        topBar.innerHTML = `
            <button type="button" onclick="backToArchiveOverview()" style="background:#0f172a; color:#ffffff; border:none; border-radius:10px; padding:8px 14px; font-size:12.5px; font-weight:800; cursor:pointer; font-family:'Cairo',sans-serif; display:inline-flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-arrow-right"></i> العودة إلى ملفات الأشهر والسجل
            </button>
            <span style="background:#e2e8f0; color:#0f172a; padding:6px 12px; border-radius:10px; font-size:12px; font-weight:800;">
                ملف الشهر: ${selectedCompletedMonthKey} (${monthDays.length} يوم)
            </span>
        `;
        container.appendChild(topBar);

        const summaryBox = document.createElement('div');
        summaryBox.style.cssText = 'background:linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%); border:1.5px solid #10b981; border-radius:14px; padding:14px; margin-bottom:14px; text-align:right;';
        summaryBox.innerHTML = `
            <div style="font-size:14px; font-weight:900; color:#065f46; margin-bottom:8px;">
                <i class="fa-solid fa-folder-open" style="margin-left:6px;"></i> ملخص ملف شهر: ${monthTitle}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div style="background:#ffffff; border:1px solid #a7f3d0; border-radius:10px; padding:10px;">
                    <div style="font-size:11px; color:#047857; font-weight:800;">مجموع TOTAL للشهر كامل</div>
                    <div style="font-size:14px; color:#065f46; font-weight:900; margin-top:2px;" dir="ltr">${stats.formattedTotal}</div>
                </div>
                <div style="background:#ffffff; border:1px solid #a7f3d0; border-radius:10px; padding:10px;">
                    <div style="font-size:11px; color:#047857; font-weight:800;">المتراكم الكلي M³/DAY للشهر</div>
                    <div style="font-size:14px; color:#065f46; font-weight:900; margin-top:2px;" dir="ltr">${stats.formattedM3Day}</div>
                </div>
            </div>
            <div style="font-size:11.5px; color:#475569; font-weight:700; margin-top:8px;">
                عدد أيام الشهر المسجلة: <strong>${stats.daysCount}</strong> يوم (المحتسبة حسابياً: <strong>${stats.completedDaysCount}</strong> يوم)
            </div>
        `;
        container.appendChild(summaryBox);

        if (monthDays.length === 0) {
            container.innerHTML += '<p style="text-align:center; color:#64748b; font-size:13px;">لا توجد أيام مسجلة في هذا الشهر.</p>';
        } else {
            monthDays.forEach(d => {
                container.appendChild(buildArchiveDayCardElement(d));
            });
        }
        return;
    }

    container.innerHTML = '';

    // 1. ملفات الأشهر المكتملة السابقة
    if (sortedCompletedMonthKeys.length > 0) {
        const monthsHeader = document.createElement('div');
        monthsHeader.style.cssText = 'font-size:13.5px; font-weight:900; color:#0f172a; margin-bottom:8px; display:flex; align-items:center; gap:6px;';
        monthsHeader.innerHTML = `<i class="fa-solid fa-folder-closed" style="color:#0284c7;"></i> ملفات الأشهر المكتملة (المجموع والمتراكم الشهري):`;
        container.appendChild(monthsHeader);

        sortedCompletedMonthKeys.forEach(mKey => {
            const mDays = completedMonthsMap.get(mKey) || [];
            const stats = computeMonthCumulativeStats(mDays);
            const mTitle = formatMonthTitleArabic(mKey);

            const folderCard = document.createElement('div');
            folderCard.className = 'archive-card';
            folderCard.style.cssText = 'border-right-color:#0284c7; background:#f8fafc; margin-bottom:10px;';
            folderCard.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <h4 style="margin:0; color:#0f172a;"><i class="fa-solid fa-folder" style="color:#0284c7; margin-left:6px;"></i> ${mTitle} (${mKey})</h4>
                    <span style="background:#e0f2fe; color:#0369a1; font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px;">${mDays.length} يوم • فتح الملف</span>
                </div>
                <p style="margin-top:8px;"><strong>مجموع TOTAL الشهري:</strong> <span style="color:#15803d; font-weight:900;" dir="ltr">${stats.formattedTotal}</span></p>
                <p><strong>المتراكم M³/DAY الشهري:</strong> <span style="color:#15803d; font-weight:900;" dir="ltr">${stats.formattedM3Day}</span></p>
            `;
            folderCard.onclick = () => openCompletedMonthFolder(mKey);
            container.appendChild(folderCard);
        });
    }

    // 2. أيام الشهر الحالي النشط
    const currentMonthSectionTitle = document.createElement('div');
    currentMonthSectionTitle.style.cssText = 'font-size:13.5px; font-weight:900; color:#0d9488; margin:12px 0 8px; display:flex; align-items:center; gap:6px;';
    currentMonthSectionTitle.innerHTML = `<i class="fa-solid fa-calendar-day"></i> أيام الشهر الحالي (${formatMonthTitleArabic(activeMonthKey)}):`;
    container.appendChild(currentMonthSectionTitle);

    if (currentMonthRecords.length === 0) {
        const emptyCurrent = document.createElement('p');
        emptyCurrent.style.cssText = 'text-align:center; color:#64748b; font-size:13px; padding:12px 0;';
        emptyCurrent.textContent = 'لا توجد ورديات مؤرشفة في الشهر الحالي حتى الآن.';
        container.appendChild(emptyCurrent);
    } else {
        currentMonthRecords.forEach(d => {
            container.appendChild(buildArchiveDayCardElement(d));
        });
    }
}

async function openArchiveSection() {
    await checkAndRunAutoArchiveAt630();
    selectedCompletedMonthKey = null;
    const container = document.getElementById('archive-records-container');
    container.innerHTML = '<p style="text-align: center; color: #64748b; font-size: 13px;">جاري جلب الأرشيف وملفات الأشهر...</p>';
    await ensureFirebaseSession();
    db.collection("shift_archive_gas").get()
        .then(snapshot => {
            archiveRecordsCache = [];
            snapshot.forEach(doc => {
                archiveRecordsCache.push({ id: doc.id, ...doc.data() });
            });
            archiveRecordsCache.sort((a, b) => getSortableDateTimestamp(b.date) - getSortableDateTimestamp(a.date));
            renderArchiveSectionContent();
        })
        .catch(err => {
            container.innerHTML = '<p style="text-align: center; color: #ef4444;">خطأ في جلب الأرشيف: ' + err.message + '</p>';
        });
    switchTab('archive-section');
}

function computeTotalsFromFlowsArray(flowsArr) {
    let sum = 0;
    let filledCount = 0;
    for (let i = 0; i < hours.length; i++) {
        const raw = flowsArr && flowsArr[i] !== undefined ? String(flowsArr[i]).trim() : '';
        if (raw !== '' && !isNaN(Number(raw))) {
            sum += parseFloat(raw);
            filledCount++;
        }
    }
    if (filledCount === hours.length) {
        const result1 = sum * 2;
        const result2 = result1 * 37.226;
        return {
            total: formatNumber(result1),
            m3day: formatNumber(result2)
        };
    }
    return {
        total: '-',
        m3day: '-'
    };
}

function setEditArchiveQutry(status) {
    if (!hasAdminPanelAccess(currentEmployee)) return;
    editArchiveQutryState = status;
    const offBtn = document.getElementById('edit-arch-qutry-off');
    const onBtn = document.getElementById('edit-arch-qutry-on');
    if (offBtn) offBtn.className = status === 'off' ? 'status-btn active-off' : 'status-btn';
    if (onBtn) onBtn.className = status === 'on' ? 'status-btn active-on' : 'status-btn';
}

function setEditArchiveSolar(solar, status) {
    if (!hasAdminPanelAccess(currentEmployee)) return;
    if (solar === 'A') {
        editArchiveSolarAState = status;
        const offBtn = document.getElementById('edit-arch-solarA-off');
        const onBtn = document.getElementById('edit-arch-solarA-on');
        const pRow = document.getElementById('edit-arch-solarA-pressures');
        if (offBtn) offBtn.className = status === 'off' ? 'status-btn active-off' : 'status-btn';
        if (onBtn) onBtn.className = status === 'on' ? 'status-btn active-on' : 'status-btn';
        if (pRow) pRow.style.display = status === 'on' ? 'grid' : 'none';
    } else {
        editArchiveSolarBState = status;
        const offBtn = document.getElementById('edit-arch-solarB-off');
        const onBtn = document.getElementById('edit-arch-solarB-on');
        const pRow = document.getElementById('edit-arch-solarB-pressures');
        if (offBtn) offBtn.className = status === 'off' ? 'status-btn active-off' : 'status-btn';
        if (onBtn) onBtn.className = status === 'on' ? 'status-btn active-on' : 'status-btn';
        if (pRow) pRow.style.display = status === 'on' ? 'grid' : 'none';
    }
}

function recalculateArchiveEditTotals() {
    const flowsArr = hours.map((h, i) => {
        const el = document.getElementById(`edit_arch_flow_${i}`);
        return el ? el.value : '';
    });
    const computed = computeTotalsFromFlowsArray(flowsArr);
    const tEl = document.getElementById('edit-arch-total-preview');
    const mEl = document.getElementById('edit-arch-m3day-preview');
    if (tEl) tEl.textContent = computed.total;
    if (mEl) mEl.textContent = computed.m3day;
}

function renderArchiveReadOnlyView(d) {
    const detailsContainer = document.getElementById('modal-content-details');
    const canEditArchive = hasAdminPanelAccess(currentEmployee);

    let html = `
        <div style="background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #cbd5e1;">
            <p><strong>كابسة القطري:</strong> ${formatStatusBadgeHtml(d.qutry === 'on')}</p>
            <p style="margin-top:4px;"><strong>الخط الوطني:</strong> ${d.national || '-'}</p>
            <p><strong>الخط الإيراني:</strong> ${d.iranian || '-'}</p>
            <div style="margin-top:6px;">${buildSolarUnitHtml('Solar A', d.solarA)}</div>
            <div style="margin-top:4px;">${buildSolarUnitHtml('Solar B', d.solarB)}</div>
            <p style="margin-top:6px;"><strong>الملاحظات:</strong> ${d.notes || '-'}</p>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:5px; flex-wrap:wrap;">
            <div style="font-weight:800; color:#0d9488;">قراءات الساعات:</div>
            ${canEditArchive ? `
                <button type="button" onclick="enterArchiveEditMode()" style="background:#f59e0b; color:#ffffff; border:none; border-radius:10px; padding:6px 12px; font-size:12px; font-weight:800; cursor:pointer; font-family:'Cairo',sans-serif; display:inline-flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-pen-to-square"></i> تعديل بيانات الوردية
                </button>
            ` : ''}
        </div>
    `;

    hours.forEach((h, i) => {
        const pal = HOUR_ROW_PALETTE[i % HOUR_ROW_PALETTE.length];
        html += `
            <div style="display:grid; grid-template-columns: 0.8fr 1fr 1fr 1fr; gap:6px; direction:ltr; background:${pal.bg}; padding:6px 10px; border-radius:6px; font-size:12px; text-align:center; font-weight:700; border:1px solid #e2e8f0;">
                <span style="background:${pal.timeBg}; border-radius:4px; padding:2px 4px; font-weight:900; color:#0f172a;">${h}</span>
                <span>Grid: ${(d.grids && d.grids[i]) || '-'}</span>
                <span>Strat: ${(d.strats && d.strats[i]) || '-'}</span>
                <span style="color:${pal.flowColor}; font-weight:800;">Flow: ${(d.flows && d.flows[i]) || '-'}</span>
            </div>
        `;
    });

    html += `
        <div style="margin-top:10px; background:#f0fdf4; padding:10px; border-radius:8px; border:1px solid #22c55e; text-align:right;">
            <p style="color:#15803d; font-weight:900;">TOTAL: ${d.total}</p>
            <p style="color:#15803d; font-weight:900;">M³/DAY: ${d.m3day}</p>
        </div>
    `;

    detailsContainer.innerHTML = html;
}

function enterArchiveEditMode() {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ تعديل بيانات الوردية متاح للمؤسس ومسؤول شعبة GTU فقط.');
        return;
    }
    const d = activeArchiveRecordForPrint;
    if (!d) return;

    isEditingArchiveRecord = true;
    editArchiveQutryState = d.qutry === 'on' ? 'on' : 'off';
    editArchiveSolarAState = (d.solarA && d.solarA.state === 'on') ? 'on' : 'off';
    editArchiveSolarBState = (d.solarB && d.solarB.state === 'on') ? 'on' : 'off';

    const grids = Array.isArray(d.grids) ? d.grids : [];
    const strats = Array.isArray(d.strats) ? d.strats : [];
    const flows = Array.isArray(d.flows) ? d.flows : [];
    const sucA = d.solarA && d.solarA.suc !== undefined ? d.solarA.suc : '';
    const disA = d.solarA && d.solarA.dis !== undefined ? d.solarA.dis : '';
    const sucB = d.solarB && d.solarB.suc !== undefined ? d.solarB.suc : '';
    const disB = d.solarB && d.solarB.dis !== undefined ? d.solarB.dis : '';

    const detailsContainer = document.getElementById('modal-content-details');
    let rowsHtml = '';
    hours.forEach((h, i) => {
        const pal = HOUR_ROW_PALETTE[i % HOUR_ROW_PALETTE.length];
        rowsHtml += `
            <div style="display:grid; grid-template-columns: 0.75fr 1fr 1fr 1fr; gap:6px; direction:ltr; align-items:center; background:${pal.bg}; padding:6px; border-radius:8px; border:1px solid #cbd5e1;">
                <span style="background:${pal.timeBg}; border-radius:6px; padding:5px 4px; font-weight:900; font-size:12px; text-align:center; color:#0f172a;">${h}</span>
                <input type="number" id="edit_arch_grid_${i}" value="${grids[i] || ''}" placeholder="Grid" style="padding:6px; font-size:12px; text-align:center; background:#ffffff;">
                <input type="number" id="edit_arch_strat_${i}" value="${strats[i] || ''}" placeholder="Strat" style="padding:6px; font-size:12px; text-align:center; background:#ffffff;">
                <input type="number" id="edit_arch_flow_${i}" value="${flows[i] || ''}" placeholder="Flow" oninput="recalculateArchiveEditTotals()" style="padding:6px; font-size:12px; text-align:center; background:#ffffff;">
            </div>
        `;
    });

    detailsContainer.innerHTML = `
        <div style="background:#fffbeb; border:1.5px solid #f59e0b; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:10px; text-align:right;">
            <div style="font-size:13px; font-weight:900; color:#92400e;">
                <i class="fa-solid fa-sliders"></i> وضع تعديل كافة معلومات الوردية (${d.date})
            </div>

            <div>
                <label>كابسة القطري (Qutry Compressor):</label>
                <div class="status-buttons">
                    <button type="button" id="edit-arch-qutry-off" class="status-btn ${editArchiveQutryState === 'off' ? 'active-off' : ''}" onclick="setEditArchiveQutry('off')">✕ إطفاء (OFF)</button>
                    <button type="button" id="edit-arch-qutry-on" class="status-btn ${editArchiveQutryState === 'on' ? 'active-on' : ''}" onclick="setEditArchiveQutry('on')">✓ تشغيل (ON)</button>
                </div>
            </div>

            <div class="lines-pressures">
                <div class="line-box">
                    <label>الخط الوطني (National Line)</label>
                    <input type="number" id="edit-arch-national" value="${d.national || ''}" placeholder="-">
                </div>
                <div class="line-box">
                    <label>الخط الإيراني (Iranian Line)</label>
                    <input type="number" id="edit-arch-iranian" value="${d.iranian || ''}" placeholder="-">
                </div>
            </div>

            <div>
                <label>Solar A:</label>
                <div class="status-buttons">
                    <button type="button" id="edit-arch-solarA-off" class="status-btn ${editArchiveSolarAState === 'off' ? 'active-off' : ''}" onclick="setEditArchiveSolar('A', 'off')">✕ إطفاء (OFF)</button>
                    <button type="button" id="edit-arch-solarA-on" class="status-btn ${editArchiveSolarAState === 'on' ? 'active-on' : ''}" onclick="setEditArchiveSolar('A', 'on')">✓ تشغيل (ON)</button>
                </div>
                <div id="edit-arch-solarA-pressures" style="display:${editArchiveSolarAState === 'on' ? 'grid' : 'none'}; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px; direction:ltr;">
                    <input type="number" id="edit-arch-solarA-suc" value="${sucA}" placeholder="Suction" style="padding:7px; font-size:12px; text-align:center;">
                    <input type="number" id="edit-arch-solarA-dis" value="${disA}" placeholder="Discharge" style="padding:7px; font-size:12px; text-align:center;">
                </div>
            </div>

            <div>
                <label>Solar B:</label>
                <div class="status-buttons">
                    <button type="button" id="edit-arch-solarB-off" class="status-btn ${editArchiveSolarBState === 'off' ? 'active-off' : ''}" onclick="setEditArchiveSolar('B', 'off')">✕ إطفاء (OFF)</button>
                    <button type="button" id="edit-arch-solarB-on" class="status-btn ${editArchiveSolarBState === 'on' ? 'active-on' : ''}" onclick="setEditArchiveSolar('B', 'on')">✓ تشغيل (ON)</button>
                </div>
                <div id="edit-arch-solarB-pressures" style="display:${editArchiveSolarBState === 'on' ? 'grid' : 'none'}; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px; direction:ltr;">
                    <input type="number" id="edit-arch-solarB-suc" value="${sucB}" placeholder="Suction" style="padding:7px; font-size:12px; text-align:center;">
                    <input type="number" id="edit-arch-solarB-dis" value="${disB}" placeholder="Discharge" style="padding:7px; font-size:12px; text-align:center;">
                </div>
            </div>

            <div>
                <label>الملاحظات:</label>
                <textarea id="edit-arch-notes" rows="2" placeholder="اكتب ملاحظات الوردية...">${d.notes || ''}</textarea>
            </div>

            <div style="font-size:12.5px; font-weight:900; color:#0f172a; margin-top:4px;">قراءات الساعات (من اليسار إلى اليمين):</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${rowsHtml}
            </div>

            <div style="background:#f0fdf4; border:1px solid #22c55e; border-radius:10px; padding:10px; font-size:12.5px; font-weight:900; color:#15803d;">
                <div>TOTAL: <span id="edit-arch-total-preview">${d.total || '-'}</span></div>
                <div>M³/DAY: <span id="edit-arch-m3day-preview">${d.m3day || '-'}</span></div>
            </div>

            <div style="display:flex; gap:8px; margin-top:4px;">
                <button type="button" id="save-archive-edit-btn" onclick="saveArchiveRecordChanges()" style="flex:1; background:#16a34a; color:#ffffff; border:none; border-radius:10px; padding:11px; font-size:13px; font-weight:900; cursor:pointer; font-family:'Cairo',sans-serif;">
                    <i class="fa-solid fa-floppy-disk"></i> حفظ التعديلات
                </button>
                <button type="button" onclick="cancelArchiveEditMode()" style="background:#e2e8f0; color:#1e293b; border:none; border-radius:10px; padding:11px 14px; font-size:13px; font-weight:800; cursor:pointer; font-family:'Cairo',sans-serif;">
                    إلغاء
                </button>
            </div>
        </div>
    `;
}

function cancelArchiveEditMode() {
    isEditingArchiveRecord = false;
    if (activeArchiveRecordForPrint) {
        renderArchiveReadOnlyView(activeArchiveRecordForPrint);
    }
}

async function saveArchiveRecordChanges() {
    if (!hasAdminPanelAccess(currentEmployee)) {
        alert('⚠️ تعديل بيانات الوردية متاح للمؤسس ومسؤول شعبة GTU فقط.');
        return;
    }
    const d = activeArchiveRecordForPrint;
    if (!d) return;

    const saveBtn = document.getElementById('save-archive-edit-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ جاري الحفظ...';
    }

    const grids = hours.map((h, i) => {
        const el = document.getElementById(`edit_arch_grid_${i}`);
        return el ? el.value : '';
    });
    const strats = hours.map((h, i) => {
        const el = document.getElementById(`edit_arch_strat_${i}`);
        return el ? el.value : '';
    });
    const flows = hours.map((h, i) => {
        const el = document.getElementById(`edit_arch_flow_${i}`);
        return el ? el.value : '';
    });

    const nationalVal = document.getElementById('edit-arch-national') ? document.getElementById('edit-arch-national').value : '';
    const iranianVal = document.getElementById('edit-arch-iranian') ? document.getElementById('edit-arch-iranian').value : '';
    const sucAVal = document.getElementById('edit-arch-solarA-suc') ? document.getElementById('edit-arch-solarA-suc').value : '';
    const disAVal = document.getElementById('edit-arch-solarA-dis') ? document.getElementById('edit-arch-solarA-dis').value : '';
    const sucBVal = document.getElementById('edit-arch-solarB-suc') ? document.getElementById('edit-arch-solarB-suc').value : '';
    const disBVal = document.getElementById('edit-arch-solarB-dis') ? document.getElementById('edit-arch-solarB-dis').value : '';
    const notesVal = document.getElementById('edit-arch-notes') ? document.getElementById('edit-arch-notes').value : '';

    const totals = computeTotalsFromFlowsArray(flows);
    const editorName = currentEmployee ? currentEmployee.name : 'الإدارة';

    const updatedRecord = {
        ...d,
        grids: grids,
        strats: strats,
        flows: flows,
        qutry: editArchiveQutryState,
        national: nationalVal,
        iranian: iranianVal,
        solarA: {
            state: editArchiveSolarAState,
            suc: sucAVal,
            dis: disAVal
        },
        solarB: {
            state: editArchiveSolarBState,
            suc: sucBVal,
            dis: disBVal
        },
        notes: notesVal,
        total: totals.total,
        m3day: totals.m3day,
        updatedBy: editorName,
        updatedAt: new Date().toISOString()
    };

    const payloadToSave = { ...updatedRecord };
    delete payloadToSave.id;

    await ensureFirebaseSession();
    try {
        if (d.id) {
            await db.collection("shift_archive_gas").doc(d.id).set(payloadToSave, { merge: true });
        } else if (d.date) {
            await upsertArchiveRecordByDate(payloadToSave);
        }

        const cacheIdx = archiveRecordsCache.findIndex(item =>
            (d.id && item.id === d.id) || (d.date && item.date === d.date)
        );
        if (cacheIdx !== -1) {
            archiveRecordsCache[cacheIdx] = { ...archiveRecordsCache[cacheIdx], ...updatedRecord };
        }
        renderArchiveSectionContent();

        activeArchiveRecordForPrint = updatedRecord;
        activeSheetRecordForExport = updatedRecord;
        isEditingArchiveRecord = false;
        renderArchiveReadOnlyView(updatedRecord);
        alert('✅ تم حفظ التعديلات على بيانات الوردية وتحديث المجاميع بنجاح.');
    } catch (err) {
        alert('❌ تعذر حفظ التعديلات: ' + err.message);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'حفظ التعديلات';
        }
    }
}

function showArchiveDetailModal(d) {
    activeArchiveRecordForPrint = d;
    isEditingArchiveRecord = false;
    document.getElementById('modal-date-title').textContent = `تفاصيل وردية تاريخ: ${d.date}`;
    renderArchiveReadOnlyView(d);

    const archivePrintBtn = document.getElementById('archive-print-sheet-btn');
    if (archivePrintBtn) {
        archivePrintBtn.onclick = () => openPrintableSheetForData(activeArchiveRecordForPrint);
    }

    document.getElementById('archiveDetailModal').style.display = 'flex';
}

function closeArchiveModal() {
    activeArchiveRecordForPrint = null;
    isEditingArchiveRecord = false;
    document.getElementById('archiveDetailModal').style.display = 'none';
}
