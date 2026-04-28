// js/booking.js

function updateTotal() {
  const checkIn  = document.getElementById('checkIn').value;
  const checkOut = document.getElementById('checkOut').value;
  const box      = document.getElementById('totalPreview');

  if (!checkIn || !checkOut) { box.style.display = 'none'; return; }

  const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  if (nights <= 0) { box.style.display = 'none'; return; }

  const adults      = parseInt(document.getElementById('numAdults')?.value)   || 1;
  const children    = parseInt(document.getElementById('numChildren')?.value) || 0;
  const guestAge    = parseInt(document.getElementById('guestAge')?.value)    || 0;
  const baseRate    = window.RATE || 0;

  // Senior discount on the base nightly rate (applies when oldest guest qualifies)
  const seniorAge   = window.SENIOR_AGE          || null;
  const seniorDisc  = window.SENIOR_DISCOUNT_PCT || 0;
  const isSenior    = seniorAge && guestAge >= seniorAge;
  const effectiveRate = isSenior ? baseRate * (1 - seniorDisc / 100) : baseRate;

  // Children charge: % of BASE (not discounted) rate per child per night
  const childRatePct = window.CHILD_RATE_PCT || 0;
  const childCharge  = children * (baseRate * childRatePct / 100) * nights;

  const adultCharge  = effectiveRate * nights;
  const total        = adultCharge + childCharge;

  // Build a breakdown string
  const lines = [];
  lines.push(`${nights} night${nights !== 1 ? 's' : ''}`);
  if (isSenior) lines.push(`Senior discount −${seniorDisc}% applied`);
  if (children > 0 && childRatePct > 0) lines.push(`${children} child${children !== 1 ? 'ren' : ''} @ ${childRatePct}%`);

  document.getElementById('nightsLabel').textContent = lines.join(' · ');
  document.getElementById('totalAmount').textContent = 'Total: ' + Number(total).toLocaleString('vi-VN') + ' ₫';
  box.style.display = 'flex';

  // Store computed total so submitBooking sends the right amount
  window._computedTotal = total;
}

async function submitBooking() {
  const name        = document.getElementById('guestName').value.trim();
  const email       = document.getElementById('guestEmail').value.trim();
  const checkIn     = document.getElementById('checkIn').value;
  const checkOut    = document.getElementById('checkOut').value;
  const numAdults   = parseInt(document.getElementById('numAdults').value)   || 1;
  const numChildren = parseInt(document.getElementById('numChildren').value) || 0;
  const guestAge    = parseInt(document.getElementById('guestAge')?.value)   || 0;
  const errEl       = document.getElementById('error');
  const successEl   = document.getElementById('success');
  const successMsg  = document.getElementById('successMsg');
  const btn         = document.getElementById('confirmBtn');

  errEl.textContent       = '';
  successEl.style.display = 'none';

  if (!name)          { errEl.textContent = 'Guest name is required.'; return; }
  if (!checkIn)       { errEl.textContent = 'Check-in date is required.'; return; }
  if (!checkOut)      { errEl.textContent = 'Check-out date is required.'; return; }
  if (numAdults < 1)  { errEl.textContent = 'At least 1 adult is required.'; return; }

  const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  if (nights <= 0) { errEl.textContent = 'Check-out must be after check-in.'; return; }

  // Client-side capacity guard (server also enforces this)
  if (window.MAX_ADULTS   && numAdults   > window.MAX_ADULTS) {
    errEl.textContent = `This room fits a maximum of ${window.MAX_ADULTS} adult(s).`; return;
  }
  if (window.MAX_CHILDREN !== undefined && numChildren > window.MAX_CHILDREN) {
    errEl.textContent = `This room allows a maximum of ${window.MAX_CHILDREN} child(ren).`; return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Processing…';

  try {
    const res = await fetch(`${API}/bookings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id:      window.ROOM_ID,
        guest_name:   name,
        guest_email:  email,
        check_in:     checkIn,
        check_out:    checkOut,
        num_adults:   numAdults,
        num_children: numChildren,
        // Send pre-computed total (includes child charge + senior discount)
        // Backend will use this value directly rather than recalculating from Rate alone
        total_override: window._computedTotal || null,
      }),
    });

    const data = await res.json();

    if (res.status === 409) {
      errEl.innerHTML = `<div class="alert alert-warning rounded-0 py-2 px-3" style="font-size:13px;">
        <i class="bi bi-exclamation-triangle me-2"></i>
        This room was just booked by someone else. Please go back and choose another room.
      </div>`;
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Confirm Booking';
      return;
    }

    if (!data.success) throw new Error(data.message);

    const b = data.data;
    const guestSummary = `${b.num_adults} adult${b.num_adults !== 1 ? 's' : ''}` +
      (b.num_children > 0 ? `, ${b.num_children} child${b.num_children !== 1 ? 'ren' : ''}` : '');

    successMsg.innerHTML =
      `<div>
        <strong style="font-size:15px;">Booking Confirmed!</strong><br>
        <span style="font-size:13px; color:#555;">
          Booking ID: <strong>#${b.booking_id}</strong><br>
          Room: <strong>${b.room_number}</strong><br>
          Guests: <strong>${guestSummary}</strong><br>
          Nights: <strong>${b.nights}</strong><br>
          Total: <strong style="color:#198754;">${Number(b.total_amount).toLocaleString('vi-VN')} ₫</strong>
        </span>
        <div class="mt-3 d-flex gap-2 flex-wrap">
          <a href="mybookings.html" class="btn btn-sm" style="background:#198754;color:#fff;border-radius:0;font-size:12px;letter-spacing:1px;">
            <i class="bi bi-list-check me-1"></i>View My Bookings
          </a>
          <a href="index.html" class="btn btn-sm" style="background:#2d2d2d;color:#fff;border-radius:0;font-size:12px;letter-spacing:1px;">
            <i class="bi bi-search me-1"></i>Search More Hotels
          </a>
        </div>
      </div>`;

    successEl.style.display = 'block';
    btn.style.display = 'none';
    document.getElementById('totalPreview').style.display = 'none';

  } catch (err) {
    errEl.innerHTML = `<div class="alert alert-danger rounded-0 py-2 px-3" style="font-size:13px;">
      <i class="bi bi-exclamation-triangle me-2"></i>${err.message}
    </div>`;
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Confirm Booking';
  }
}
