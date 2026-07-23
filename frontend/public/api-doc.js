// -- i18n Language Switch --
const langStorageKey = 'api-doc-lang';

function readStoredLang() {
  try {
    return localStorage.getItem(langStorageKey) || 'en';
  } catch {
    return 'en';
  }
}

function storeLang(lang) {
  try {
    localStorage.setItem(langStorageKey, lang);
  } catch {
    // Ignore storage errors in private/sandboxed/file contexts.
  }
}

let currentLang = readStoredLang();

function detectBasePath() {
  const pathname = window.location.pathname;
  const suffix = '/api-doc.html';
  if (!pathname.endsWith(suffix)) {
    return '';
  }
  const basePath = pathname.slice(0, -suffix.length).replace(/\/+$/, '');
  return basePath === '/' ? '' : basePath;
}

function updateDeploymentExamples() {
  const basePath = detectBasePath();
  const basePathElement = document.getElementById('current-base-path');
  const healthElement = document.getElementById('current-health-url');
  if (basePathElement) {
    basePathElement.textContent = basePath || '/';
  }
  if (healthElement) {
    healthElement.textContent = window.location.origin + basePath + '/api/health';
  }
}

function setLang(lang) {
  if (lang !== 'en' && lang !== 'zh') {
    return;
  }
  currentLang = lang;
  storeLang(lang);
  // Update toggle buttons
  document.querySelectorAll('.lang-switch button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // Update all elements with data-en/data-zh
  document.querySelectorAll('[data-' + lang + ']').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text !== null) {
      // For elements that use textContent (summary, description, nav, etc.)
      if (el.tagName === 'INPUT') {
        el.placeholder = text;
      } else {
        el.textContent = text;
      }
    }
  });
  // Update html lang attribute
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

window.setLang = setLang;

function initApiDoc() {
  document.querySelectorAll('.lang-switch button[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  setLang(currentLang);
  updateDeploymentExamples();
}

// Initialize language on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApiDoc);
} else {
  initApiDoc();
}

// Toggle endpoint body
document.querySelectorAll('.endpoint-header').forEach(header => {
  header.addEventListener('click', () => {
    header.parentElement.classList.toggle('open');
  });
});

// Count endpoints
const totalEndpoints = document.querySelectorAll('.endpoint').length;
document.getElementById('total-endpoints').textContent = totalEndpoints;

// Search
const searchInput = document.getElementById('search');
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  document.querySelectorAll('.endpoint').forEach(ep => {
    const searchData = (ep.getAttribute('data-search') || '').toLowerCase();
    if (!q || searchData.includes(q)) {
      ep.classList.remove('hidden');
    } else {
      ep.classList.add('hidden');
    }
  });
});

// Sidebar active state on scroll
const sections = document.querySelectorAll('.endpoint-group');
const navLinks = document.querySelectorAll('.nav-group');

function updateActiveNav() {
  let currentId = '';
  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    if (rect.top <= 100) {
      currentId = section.id;
    }
  });
  navLinks.forEach(link => {
    link.classList.toggle('active', link.getAttribute('href') === '#' + currentId);
  });
}

window.addEventListener('scroll', updateActiveNav);
updateActiveNav();

// Smooth scroll for sidebar links
navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
