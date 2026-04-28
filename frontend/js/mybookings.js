// js/mybookings.js

let _pendingCheckoutId = null;

async function loadBookings() {
  const filter   = (document.getElementById('guestFilter').value || '').trim().toLowerCase();
  const statusEl = document.getElementById('status');
  const errorEl  = document.getElementById('error');
  const card     = document.getElementById('bookingsCard');
  const empty    = document.getElementById('emptyState');
  const tbody    = document.getElementById('bookingsBody');

  statusEl.textContent = 'Loading…';
  errorEl.textContent  = '';
  card.style.display   = 'none';
  empty.style.display  = 'none';
  tbody.innerHTML      = '';

  try {
    const res  = await fetch(`${API}/bookings`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    let rows = data.data || [];

    // Client-side filter by guest name or email
    if (filter) {
      rows = rows.filter(b =>
        (b.GuestName  || '').toLowerCase().includes(filter) ||
        (b.GuestEmail || '').toLowerCase().includes(filter)
      );
    }

    statusEl.textContent = `${rows.length} booking(s) found`;

    if (rows.length === 0) {
      empty.style.display = 'block';
      return;
    }

    rows.forEach(b => {
      const tr = document.createElement('tr');
      const isConfirmed = b.Status === 'CONFIRMED';

      const checkIn  = b.CheckIn  ? new Date(b.CheckIn).toLocaleDateString()  : '—';
      const checkOut = b.CheckOut ? new Date(b.CheckOut).toLocaleDateString() : '—';

      const adults   = b.NumAdults   != null ? b.NumAdults   : '—';
      const children = b.NumChildren != null ? b.NumChildren : '—';
      const guestLine = adults !== '—'
        ? `<div style="font-size:11px; color:#888; margin-top:2px;">
             <i class="bi bi-person-fill" style="color:#c8a96e;"></i> ${adults} adult${adults !== 1 ? 's' : ''}
             &nbsp;<i class="bi bi-person" style="color:#aaa;"></i> ${children} child${children !== 1 ? 'ren' : ''}
           </div>`
        : '';

      tr.innerHTML = `
        <td><strong style="color:#c8a96e;">#${b.ID}</strong></td>
        <td>${b.HotelName || '—'}</td>
        <td><strong>${b.RoomNumber || '—'}</strong></td>
        <td>${b.RoomType || '—'}</td>
        <td>
          <div style="font-weight:600;">${b.GuestName || '—'}</div>
          <div style="font-size:11px; color:#888;">${b.GuestEmail || ''}</div>
          ${guestLine}
        </td>
        <td>${checkIn}</td>
        <td>${checkOut}</td>
        <td style="font-weight:600;">${Number(b.TotalAmount || 0).toLocaleString('vi-VN')}</td>
        <td>
          ${isConfirmed
            ? '<span class="badge-confirmed"><i class="bi bi-check-circle me-1"></i>CONFIRMED</span>'
            : '<span class="badge-cancelled"><i class="bi bi-x-circle me-1"></i>CANCELLED</span>'}
        </td>
        <td>
          <button class="btn btn-checkout" ${isConfirmed ? '' : 'disabled'}
            onclick="promptCheckout(${b.ID})">
            <i class="bi bi-box-arrow-right me-1"></i>Check Out
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    card.style.display = 'block';

  } catch (err) {
    statusEl.textContent = '';
    errorEl.innerHTML = `<div class="alert alert-danger rounded-0 py-2 px-3 mb-0" style="font-size:13px;">
      <i class="bi bi-exclamation-triangle me-2"></i>${err.message}
    </div>`;
  }
}

function promptCheckout(bookingId) {
  _pendingCheckoutId = bookingId;
  document.getElementById('modalBookingId').textContent = '#' + bookingId;
  const modal = new bootstrap.Modal(document.getElementById('checkoutModal'));
  modal.show();

  document.getElementById('confirmCheckoutBtn').onclick = () => {
    modal.hide();
    doCheckout(bookingId);
  };
}

async function doCheckout(bookingId) {
  const statusEl = document.getElementById('status');
  const errorEl  = document.getElementById('error');

  statusEl.textContent = 'Checking out…';
  errorEl.textContent  = '';

  try {
    const res  = await fetch(`${API}/bookings/${bookingId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    statusEl.innerHTML = `<span style="color:#198754; font-weight:600;">
      <i class="bi bi-check-circle me-1"></i>Booking #${bookingId} checked out successfully. Room is now available.
    </span>`;

    // Refresh the table
    await loadBookings();

  } catch (err) {
    statusEl.textContent = '';
    errorEl.innerHTML = `<div class="alert alert-danger rounded-0 py-2 px-3 mb-0" style="font-size:13px;">
      <i class="bi bi-exclamation-triangle me-2"></i>Checkout failed: ${err.message}
    </div>`;
  }
}
