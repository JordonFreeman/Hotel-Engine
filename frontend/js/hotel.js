// js/hotel.js

async function loadCatalog(hotelId) {
  try {
    const res  = await fetch(`${API}/hotels/${hotelId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const h = data.data;

    document.getElementById('hotelName').textContent = h.name;
    document.getElementById('hotelMeta').innerHTML =
      `<i class="bi bi-geo-alt me-1"></i>${h.city || ''}` +
      (h.star_rating ? `&nbsp;&nbsp;·&nbsp;&nbsp;<span class="stars-gold">${'★'.repeat(Math.round(h.star_rating))}</span> ${h.star_rating} stars` : '');
    document.getElementById('hotelDesc').textContent = h.description || '';
    document.getElementById('hotelAddress').textContent =
      h.location ? h.location.address : 'N/A';

    const list = document.getElementById('amenitiesList');
    list.innerHTML = (h.amenities || []).map(a =>
      `<span class="amenity-pill"><i class="bi bi-check-circle me-1" style="color:#c8a96e;"></i>${a}</span>`
    ).join('');

    // Age / guest policy from MongoDB catalog
    const policyEl = document.getElementById('agePolicyBox');
    if (policyEl && h.age_policy) {
      const p = h.age_policy;
      const pr = p.pricing || {};
      const badge = p.children_allowed
        ? `<span style="background:#e8f5e9;color:#198754;border:1px solid #b2dfb2;font-size:11px;font-weight:700;padding:3px 10px;border-radius:0;display:inline-block;">
             <i class="bi bi-check-circle me-1"></i>Children Welcome
           </span>`
        : `<span style="background:#fce4e4;color:#dc3545;border:1px solid #f5c6cb;font-size:11px;font-weight:700;padding:3px 10px;border-radius:0;display:inline-block;">
             <i class="bi bi-x-circle me-1"></i>Adults Only
           </span>`;
      const details = [];
      if (p.min_age > 0)          details.push(`Minimum guest age: <strong>${p.min_age}</strong>`);
      if (p.child_free_under)     details.push(`Children under <strong>${p.child_free_under}</strong> stay free`);
      if (pr.child_rate_pct > 0)  details.push(`Children (over free age): <strong>${pr.child_rate_pct}%</strong> of room rate per night`);
      if (pr.senior_age)          details.push(`Seniors ${pr.senior_age}+: <strong>${pr.senior_discount_pct}% discount</strong> on base rate`);
      if (p.notes)                details.push(`<em style="color:#888;">${p.notes}</em>`);

      policyEl.innerHTML = `
        <div class="sec-heading"><i class="bi bi-people me-2"></i>Guest Policy</div>
        <div class="mb-2">${badge}</div>
        ${details.map(d => `<div style="font-size:13px;color:#555;margin-top:6px;">${d}</div>`).join('')}
      `;
      policyEl.style.display = 'block';

      // Store pricing on window so goBook can pass it to booking page
      window._hotelPricing = pr;
    }
  } catch (err) {
    document.getElementById('hotelName').textContent = 'Could not load catalog';
  }
}

async function loadRooms(hotelId) {
  const statusEl = document.getElementById('roomsStatus');
  const error    = document.getElementById('error');
  const table    = document.getElementById('roomsTable');
  const tbody    = document.getElementById('roomsBody');

  // Pick up any date filter from the URL (passed from search page)
  const urlParams = new URLSearchParams(window.location.search);
  const checkIn   = urlParams.get('check_in')  || '';
  const checkOut  = urlParams.get('check_out') || '';

  // Show the date filter bar if dates were passed
  updateDateFilterBar(checkIn, checkOut, hotelId);

  try {
    const params = new URLSearchParams({ hotel_id: hotelId });
    if (checkIn && checkOut) {
      params.set('check_in',  checkIn);
      params.set('check_out', checkOut);
    }

    const res  = await fetch(`${API}/rooms?${params}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    statusEl.style.display = 'none';
    table.style.display    = 'table';

    if (data.data.length === 0) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<span class="text-muted" style="font-size:13px;">No rooms found for this hotel.</span>';
      table.style.display = 'none';
      return;
    }

    tbody.innerHTML = '';
    data.data.forEach(room => {
      const tr = document.createElement('tr');
      // AvailableForDates = 1 means no confirmed booking overlaps the requested dates
      const isAvail = room.AvailableForDates === 1 || room.AvailableForDates === true;

      const capacityHtml = `
        <span title="Max adults" style="margin-right:8px;">
          <i class="bi bi-person-fill" style="color:#c8a96e;"></i> ${room.MaxAdults}
        </span>
        <span title="Max children">
          <i class="bi bi-person" style="color:#aaa; font-size:11px;"></i> ${room.MaxChildren}
        </span>`;

      tr.innerHTML = `
        <td><strong>${room.RoomNumber}</strong></td>
        <td>${room.RoomType}</td>
        <td><span style="font-weight:600; color:#c8a96e;">${Number(room.Rate).toLocaleString('vi-VN')} ₫</span></td>
        <td style="white-space:nowrap;">${capacityHtml}</td>
        <td>
          ${isAvail
            ? '<span class="status-available"><i class="bi bi-check-circle me-1"></i>AVAILABLE</span>'
            : '<span class="status-booked"><i class="bi bi-x-circle me-1"></i>BOOKED</span>'}
        </td>
        <td>
          <button class="btn btn-book-room" ${isAvail ? '' : 'disabled'}
            onclick="goBook(${room.ID},'${room.RoomNumber}','${room.RoomType}',${room.Rate},${room.MaxAdults},${room.MaxChildren})">
            <i class="bi bi-calendar-check me-1"></i>Book
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    statusEl.style.display = 'none';
    error.innerHTML = `<div class="alert alert-danger rounded-0 py-2 px-3" style="font-size:13px;">
      <i class="bi bi-exclamation-triangle me-2"></i>Failed to load rooms: ${err.message}
    </div>`;
  }
}

function updateDateFilterBar(checkIn, checkOut, hotelId) {
  const bar = document.getElementById('dateFilterBar');
  if (!bar) return;

  if (checkIn && checkOut) {
    const ci = new Date(checkIn).toLocaleDateString('en-GB',  { day:'2-digit', month:'short', year:'numeric' });
    const co = new Date(checkOut).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    bar.innerHTML = `
      <div class="d-flex align-items-center gap-3 flex-wrap">
        <span style="font-size:12px; color:#888; font-weight:700; letter-spacing:1px; text-transform:uppercase;">
          <i class="bi bi-calendar-range me-1" style="color:#c8a96e;"></i>Showing availability for
        </span>
        <strong style="color:#2d2d2d; font-size:13px;">${ci} → ${co}</strong>
        <a href="hotel.html?id=${hotelId}&name=${encodeURIComponent(document.getElementById('hotelName').textContent)}"
           style="font-size:12px; color:#888; text-decoration:none;">
           <i class="bi bi-x me-1"></i>Clear dates
        </a>
      </div>`;
    bar.style.display = 'block';
  } else {
    bar.style.display = 'none';
  }
}

function goBook(roomId, roomNumber, roomType, rate, maxAdults, maxChildren) {
  const params    = new URLSearchParams(window.location.search);
  const hotelId   = params.get('id')        || '';
  const hotelName = params.get('name')       || '';
  const checkIn   = params.get('check_in')  || '';
  const checkOut  = params.get('check_out') || '';

  const pr = window._hotelPricing || {};
  let url = `booking.html?room_id=${roomId}` +
    `&room_number=${encodeURIComponent(roomNumber)}` +
    `&room_type=${encodeURIComponent(roomType)}` +
    `&rate=${rate}` +
    `&hotel=${encodeURIComponent(hotelName)}` +
    `&hotel_id=${hotelId}` +
    `&max_adults=${maxAdults}` +
    `&max_children=${maxChildren}` +
    `&child_rate_pct=${pr.child_rate_pct || 0}` +
    `&senior_age=${pr.senior_age || ''}` +
    `&senior_discount_pct=${pr.senior_discount_pct || 0}`;

  if (checkIn)  url += `&check_in=${checkIn}`;
  if (checkOut) url += `&check_out=${checkOut}`;

  window.location.href = url;
}
