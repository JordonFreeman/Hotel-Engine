// js/reports.js

async function loadReport() {
  const year    = document.getElementById('yearInput').value;
  const quarter = document.getElementById('quarterInput').value;
  const status  = document.getElementById('status');
  const error   = document.getElementById('error');
  const table   = document.getElementById('reportTable');
  const tbody   = document.getElementById('reportBody');

  status.textContent = 'Loading...';
  error.textContent  = '';
  tbody.innerHTML    = '';
  table.style.display = 'none';

  try {
    const params = new URLSearchParams();
    if (year)    params.set('year', year);
    if (quarter) params.set('quarter', quarter);

    const res  = await fetch(`${API}/reports/top-rooms?${params}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    status.textContent = `${data.data.length} row(s) returned`;
    table.style.display = data.data.length > 0 ? 'table' : 'none';

    data.data.forEach(row => {
      const tr = document.createElement('tr');
      const rankLabel = row.RevenueRank === 1 ? '#1 Gold'
                      : row.RevenueRank === 2 ? '#2 Silver'
                      : row.RevenueRank === 3 ? '#3 Bronze' : '#' + row.RevenueRank;
      const rankClass = `rank-${row.RevenueRank}`;
      tr.innerHTML = `
        <td class="${rankClass}">${rankLabel}</td>
        <td>${row.HotelName}</td>
        <td>${row.RoomNumber}</td>
        <td>${row.RoomType}</td>
        <td>${row.Year}</td>
        <td>Q${row.Quarter}</td>
        <td>${row.BookingCount}</td>
        <td>${Number(row.TotalRevenue).toLocaleString('vi-VN')}</td>
      `;
      tbody.appendChild(tr);
    });

    if (data.data.length === 0) status.textContent = 'No revenue data found for this period.';

  } catch (err) {
    error.textContent  = 'Error: ' + err.message;
    status.textContent = '';
  }
}

async function loadAudit() {
  const tbody   = document.getElementById('auditBody');
  const table   = document.getElementById('auditTable');
  const status  = document.getElementById('auditStatus');

  tbody.innerHTML     = '';
  table.style.display = 'none';
  status.textContent  = 'Loading...';

  try {
    const res  = await fetch(`${API}/reports/rate-changes`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    if (data.data.length === 0) {
      status.textContent = 'No rate changes logged yet (trigger only fires for >50% changes).';
      return;
    }

    table.style.display = 'table';
    status.textContent  = `${data.data.length} audit entry(s)`;

    data.data.forEach(row => {
      const tr = document.createElement('tr');
      const pct = parseFloat(row.PctChange).toFixed(1);
      tr.innerHTML = `
        <td>${row.RoomNumber}</td>
        <td>${row.HotelName}</td>
        <td>${Number(row.OldRate).toLocaleString('vi-VN')}</td>
        <td>${Number(row.NewRate).toLocaleString('vi-VN')}</td>
        <td style="color:${pct > 0 ? 'red' : 'green'}">${pct > 0 ? '+' : ''}${pct}%</td>
        <td>${new Date(row.ChangedAt).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
}
