// js/search.js

// ─── State ───────────────────────────────────────────────────────────────────
let allCities    = [];   // populated on first load for autocomplete
let allAmenities = [];   // populated on first load for checkbox panel

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function initSearch() {
  await loadAllHotels();          // fill "All Hotels" tab + seed cities & amenities
  buildAmenityPanel();
  buildCityAutocomplete();
}

// ─── Load all hotels (no filters) ────────────────────────────────────────────
async function loadAllHotels() {
  try {
    const res  = await fetch(`${API}/hotels`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    // Seed city list for autocomplete
    const citySet = new Set();
    const amenSet = new Set();
    (data.data || []).forEach(h => {
      if (h.city) citySet.add(h.city);
      (h.amenities || []).forEach(a => amenSet.add(a));
    });
    allCities    = [...citySet].sort();
    allAmenities = [...amenSet].sort();

    renderRows(data.data, false, 'allBody');
    setCount('allCount', data.data.length);
  } catch (err) {
    showError('allError', 'Could not load hotels: ' + err.message);
  }
}

// ─── Main search (Search tab) ─────────────────────────────────────────────────
async function doSearch() {
  const q        = document.getElementById('qInput').value.trim();
  const city     = document.getElementById('cityInput').value.trim();
  const amenities = getCheckedAmenities();

  const tbody  = document.getElementById('resultsBody');
  const status = document.getElementById('status');
  const errEl  = document.getElementById('error');

  status.textContent = '';
  errEl.textContent  = '';
  tbody.innerHTML    = '';
  setCount('searchCount', 0);

  // Show loading spinner in table
  tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">
    <div class="spinner-border spinner-border-sm me-2" style="color:#c8a96e;"></div>Searching…
  </td></tr>`;

  try {
    let hotels = [];

    // All filters go to /api/hotels — q uses MongoDB $text, city uses regex, amenity is array match
    const params = new URLSearchParams();
    if (q)    params.set('q',       q);
    if (city) params.set('city',    city);
    if (amenities.length) params.set('amenity', amenities[0]);

    const res  = await fetch(`${API}/hotels?${params}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    hotels = data.data || [];

    // Client-side AND-filter remaining amenities (server only handles one at a time)
    if (amenities.length > 1) {
      hotels = hotels.filter(h => amenities.every(a => (h.amenities || []).includes(a)));
    }

    // Client-side city filter when q is also set (server applies both but double-check)
    if (q && city) {
      hotels = hotels.filter(h => h.city && h.city.toLowerCase().includes(city.toLowerCase()));
    }

    status.textContent = `${hotels.length} hotel(s) found`;

    tbody.innerHTML = '';
    if (hotels.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted" style="font-size:13px;">
        No hotels match your search. Try different filters.
      </td></tr>`;
      setCount('searchCount', 0);
    } else {
      renderRows(hotels, false, 'resultsBody');
      setCount('searchCount', hotels.length);
    }

    // Switch to Search tab to show results
    document.getElementById('tab-search').click();

  } catch (err) {
    tbody.innerHTML = '';
    errEl.innerHTML = `<div class="alert alert-danger rounded-0 py-2 px-3" style="font-size:13px;">
      <i class="bi bi-exclamation-triangle me-2"></i>${err.message}
    </div>`;
  }
}

// ─── Render rows into a tbody ─────────────────────────────────────────────────
function renderRows(hotels, showScore, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';
  hotels.forEach(h => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = () => {
      window.location.href = `hotel.html?id=${h.hotel_id}&name=${encodeURIComponent(h.name)}`;
    };

    const stars = h.star_rating
      ? '<span style="color:#c8a96e;">' + '★'.repeat(Math.round(h.star_rating)) + '</span> ' + h.star_rating
      : '—';

    const amenityHtml = (h.amenities || []).slice(0, 5).map(a =>
      `<span class="amenity-tag">${a}</span>`
    ).join('');

    const scoreHtml = showScore
      ? `<span class="match-badge">${h._matchedBy || '—'}</span>`
      : '—';

    tr.innerHTML = `
      <td><strong style="font-size:14px;">${h.name}</strong></td>
      <td><i class="bi bi-geo-alt" style="color:#c8a96e; font-size:12px;"></i> ${h.city || '—'}</td>
      <td>${stars}</td>
      <td>${amenityHtml || '<span class="text-muted" style="font-size:12px;">—</span>'}</td>
      <td>${scoreHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Amenity checkbox panel ────────────────────────────────────────────────────
function buildAmenityPanel() {
  const panel = document.getElementById('amenityPanel');
  if (!panel || allAmenities.length === 0) return;

  panel.innerHTML = allAmenities.map(a => `
    <div class="amenity-check-item" onclick="toggleAmenity(this)">
      <i class="bi bi-square check-icon"></i>
      <span>${a}</span>
    </div>
  `).join('');
}

function toggleAmenity(el) {
  el.classList.toggle('selected');
  const icon = el.querySelector('.check-icon');
  icon.className = el.classList.contains('selected')
    ? 'bi bi-check-square-fill check-icon'
    : 'bi bi-square check-icon';
  updateAmenityLabel();
}

function getCheckedAmenities() {
  return [...document.querySelectorAll('.amenity-check-item.selected')]
    .map(el => el.querySelector('span').textContent.trim());
}

function updateAmenityLabel() {
  const checked = getCheckedAmenities();
  const btn = document.getElementById('amenityToggleBtn');
  if (!btn) return;
  btn.innerHTML = checked.length === 0
    ? '<i class="bi bi-funnel me-1"></i>Amenities'
    : `<i class="bi bi-funnel-fill me-1"></i>${checked.length} selected`;
  btn.classList.toggle('btn-amenity-active', checked.length > 0);
}

function clearAmenities() {
  document.querySelectorAll('.amenity-check-item.selected').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('.check-icon').className = 'bi bi-square check-icon';
  });
  updateAmenityLabel();
}

// ─── City autocomplete ────────────────────────────────────────────────────────
function buildCityAutocomplete() {
  const input = document.getElementById('cityInput');
  const box   = document.getElementById('citySuggestions');
  if (!input || !box) return;

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    box.innerHTML = '';
    if (!val) { box.style.display = 'none'; return; }

    // Score: starts-with > contains > fuzzy char match
    const scored = allCities
      .map(city => {
        const c = city.toLowerCase();
        let score = 0;
        if (c.startsWith(val))      score = 100;
        else if (c.includes(val))   score = 60;
        else {
          // simple subsequence match
          let i = 0;
          for (const ch of val) { const pos = c.indexOf(ch, i); if (pos === -1) { score = -1; break; } score += 1; i = pos + 1; }
        }
        return { city, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (scored.length === 0) { box.style.display = 'none'; return; }

    scored.forEach(({ city }) => {
      const item = document.createElement('div');
      item.className = 'city-suggest-item';
      // Highlight matching chars
      const hi = city.replace(new RegExp(`(${val})`, 'gi'), '<mark>$1</mark>');
      item.innerHTML = `<i class="bi bi-geo-alt me-2" style="color:#c8a96e;font-size:12px;"></i>${hi}`;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = city;
        box.style.display = 'none';
      });
      box.appendChild(item);
    });
    box.style.display = 'block';
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { box.style.display = 'none'; }, 150);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { box.style.display = 'none'; doSearch(); }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n + (n === 1 ? ' hotel' : ' hotels');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="alert alert-warning rounded-0 py-2 px-3 mb-0" style="font-size:13px;">${msg}</div>`;
}

function clearSearch() {
  document.getElementById('qInput').value    = '';
  document.getElementById('cityInput').value = '';
  clearAmenities();
  document.getElementById('status').textContent = '';
  document.getElementById('error').textContent  = '';
  document.getElementById('resultsBody').innerHTML = '';
  setCount('searchCount', 0);
}
