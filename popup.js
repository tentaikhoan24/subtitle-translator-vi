// popup.js — SubTrans VI

const defaults = {
  enabled: true,
  targetLang: 'vi',
  fontSize: '16',
  bgOpacity: '85',
  showOriginal: true,
  boxPosition: 'bottom',
  customPos: null,
};

function showCustomOption(on) {
  document.querySelector('#boxPosition option[value="custom"]').hidden = !on;
}

// Load saved settings
chrome.storage.sync.get(defaults, (cfg) => {
  document.getElementById('enableToggle').checked = cfg.enabled;
  document.getElementById('toggleLabel').textContent = cfg.enabled ? 'BẬT' : 'TẮT';
  document.getElementById('targetLang').value = cfg.targetLang;
  document.getElementById('fontSize').value = cfg.fontSize;
  document.getElementById('fontSizeVal').textContent = cfg.fontSize + 'px';
  document.getElementById('bgOpacity').value = cfg.bgOpacity;
  document.getElementById('bgOpacityVal').textContent = cfg.bgOpacity + '%';
  document.getElementById('showOriginal').checked = cfg.showOriginal;
  showCustomOption(!!cfg.customPos);
  document.getElementById('boxPosition').value = cfg.customPos ? 'custom' : cfg.boxPosition;
});

function save(key, value) {
  chrome.storage.sync.set({ [key]: value });
  notifyContent();
}

function notifyContent() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'CONFIG_UPDATED',
      config: {
        enabled: document.getElementById('enableToggle').checked,
        targetLang: document.getElementById('targetLang').value,
        fontSize: document.getElementById('fontSize').value,
        bgOpacity: document.getElementById('bgOpacity').value / 100,
        showOriginal: document.getElementById('showOriginal').checked,
      }
    }).catch(() => {});
  });
}

// Enable toggle
document.getElementById('enableToggle').addEventListener('change', (e) => {
  const val = e.target.checked;
  document.getElementById('toggleLabel').textContent = val ? 'BẬT' : 'TẮT';
  save('enabled', val);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE', value: val }).catch(() => {});
  });
});

// Target language
document.getElementById('targetLang').addEventListener('change', (e) => {
  save('targetLang', e.target.value);
});

// Font size
document.getElementById('fontSize').addEventListener('input', (e) => {
  document.getElementById('fontSizeVal').textContent = e.target.value + 'px';
  save('fontSize', e.target.value);
});

// BG opacity
document.getElementById('bgOpacity').addEventListener('input', (e) => {
  document.getElementById('bgOpacityVal').textContent = e.target.value + '%';
  save('bgOpacity', e.target.value);
});

// Vị trí — chọn Dưới/Trên sẽ xóa vị trí đã kéo
document.getElementById('boxPosition').addEventListener('change', (e) => {
  if (e.target.value === 'custom') return;
  showCustomOption(false);
  chrome.storage.sync.remove('customPos');
  save('boxPosition', e.target.value);
});

// Show original
document.getElementById('showOriginal').addEventListener('change', (e) => {
  save('showOriginal', e.target.checked);
});
