// ── i18n Language Switch ──
let currentLang = localStorage.getItem('api-doc-lang') || 'en';

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('api-doc-lang', lang);
  // Update toggle buttons
  document.querySelectorAll('.lang-switch button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.trim() === (lang === 'zh' ? '中文' : 'EN'));
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

// Initialize language on load
document.addEventListener('DOMContentLoaded', () => setLang(currentLang));

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
