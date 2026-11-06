// ===================================================
// YOGA LAUNDRY - ADMIN DASHBOARD & KASIR
// ===================================================
(() => {
  "use strict";

  const API_URL =
    "https://script.google.com/macros/s/AKfycby-zjMOSm7k_GkQ9g5ZjbsZb9QC8t7iPyx9ajPD7biuIwn6giuNtWTSoEA_werYeuTq_Q/exec";

  const SESSION_KEY = "yoga_admin_pin_v2";

  const STATUSES = [
    "Menunggu Penjemputan",
    "Sedang Dijemput",
    "Sedang Dicuci",
    "Sedang Disetrika",
    "Siap Diantar",
    "Selesai",
    "Dibatalkan"
  ];

  const SERVICE_RATES = {
    "Cuci Lipat (Reguler)": 5000,
    "Cuci Setrika (Reguler)": 7000,
    "Setrika Saja (Reguler)": 5000,

    "Cuci Lipat (Express 24 Jam)": 7000,
    "Cuci Setrika (Express 24 Jam)": 10000,
    "Setrika Saja (Express 24 Jam)": 7000,

    "Cuci Lipat (Express 6 Jam)": 10000,
    "Cuci Setrika (Express 6 Jam)": 14000,
    "Setrika Saja (Express 6 Jam)": 10000
  };

  const PAYMENT_MARKER = "=== PEMBAYARAN KASIR ===";

  function init() {
    const $ = selector => document.querySelector(selector);

    const loginOverlay = $("#loginOverlay");
    const adminApp = $("#adminApp");
    const loginForm = $("#loginForm");
    const adminPinInput = $("#adminPin");
    const loginError = $("#loginError");

    const tableBody = $("#ordersTableBody");
    const emptyState = $("#emptyState");
    const searchInput = $("#searchInput");
    const filterStatus = $("#filterStatus");
    const refreshButton = $("#btnRefreshData");

    const receiptModal = $("#receiptModal");
    const receiptPrintArea = $("#receiptPrintArea");

    const manualModal = $("#manualOrderModal");
    const manualOrderForm = $("#manualOrderForm");

    let orders = [];
    let adminPin = "";

    let loading = false;
    let writing = false;
    let loggingIn = false;
    let manualSubmitting = false;

    let pendingManualOrder = null;
    let pendingManualSignature = "";

    // ===================================================
    // GENERAL HELPERS
    // ===================================================
    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function value(selector) {
      return $(selector)?.value?.trim() || "";
    }

    function show(modal) {
      if (modal) modal.style.display = "flex";
    }

    function hide(modal) {
      if (modal) modal.style.display = "none";
    }

    function setText(selector, text) {
      const element = $(selector);
      if (element) element.textContent = text;
    }

    function isBusy() {
      return loading || writing || manualSubmitting;
    }

    function rupiah(amount) {
      return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
      }).format(amount);
    }

    function priceFor(service) {
      const rate = SERVICE_RATES[service];

      return rate
        ? `${rupiah(rate)} / kg`
        : "Sesuai Timbangan";
    }

    function newId() {
      const suffix = globalThis.crypto?.randomUUID
        ? globalThis.crypto
            .randomUUID()
            .replace(/-/g, "")
            .slice(0, 12)
        : Date.now().toString(36) +
          Math.random().toString(36).slice(2, 8);

      return `YG-${Date.now().toString(36)}-${suffix}`
        .toUpperCase();
    }

    function orderTime() {
      return new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }) + " WIB";
    }

    function findOrder(id) {
      return orders.find(
        order => String(order.id) === String(id)
      );
    }

    function splitPaymentNote(note) {
      const text = String(note || "");
      const index = text.indexOf(PAYMENT_MARKER);

      if (index < 0) {
        return {
          customerNote: text,
          paymentText: ""
        };
      }

      return {
        customerNote: text.slice(0, index).trim(),
        paymentText: text.slice(
          index + PAYMENT_MARKER.length
        ).trim()
      };
    }

    // ===================================================
    // SESSION
    // ===================================================
    function getSessionPin() {
      try {
        return sessionStorage.getItem(SESSION_KEY) || "";
      } catch {
        return "";
      }
    }

    function rememberPin(pin) {
      try {
        if (pin) {
          sessionStorage.setItem(SESSION_KEY, pin);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
        }

        sessionStorage.removeItem("yoga_admin_auth");
      } catch (error) {
        console.warn(
          "Penyimpanan sesi tidak tersedia:",
          error
        );
      }
    }

    // ===================================================
    // DATABASE API
    // ===================================================
    async function api(
      action,
      payload = {},
      pin = adminPin
    ) {
      const controller = new AbortController();

      const timer = setTimeout(
        () => controller.abort(),
        30000
      );

      try {
        const response = await fetch(API_URL, {
          method: "POST",
          redirect: "follow",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify({
            ...payload,
            action,
            adminPin: pin
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(
            `Server mengembalikan HTTP ${response.status}.`
          );
        }

        let data;

        try {
          data = await response.json();
        } catch {
          throw new Error(
            "Respons bukan JSON. Periksa deployment Apps Script."
          );
        }

        if (!data || data.ok !== true) {
          throw new Error(
            data?.message ||
            "Database belum mengonfirmasi permintaan."
          );
        }

        return data;
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error(
            "Waktu tunggu habis. Status perubahan belum dapat " +
            "dipastikan. Muat ulang data sebelum mencoba lagi."
          );
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    // ===================================================
    // LOGIN
    // ===================================================
    function showLogin() {
      adminPin = "";
      orders = [];

      pendingManualOrder = null;
      pendingManualSignature = "";

      rememberPin("");

      hide(adminApp);
      show(loginOverlay);
      hide(receiptModal);
      hide(manualModal);

      if (tableBody) tableBody.innerHTML = "";
      if (receiptPrintArea) receiptPrintArea.innerHTML = "";

      manualOrderForm?.reset();

      if (adminPinInput) {
        adminPinInput.value = "";
        adminPinInput.focus();
      }
    }

    function showAdmin() {
      hide(loginOverlay);
      show(adminApp);
    }

    loginForm?.addEventListener("submit", async event => {
      event.preventDefault();

      if (loggingIn) return;

      const pin = value("#adminPin");
      if (!pin) return;

      loggingIn = true;

      const button = loginForm.querySelector(
        '[type="submit"]'
      );

      if (button) button.disabled = true;
      if (loginError) loginError.style.display = "none";

      try {
        await api("adminLogin", {}, pin);

        adminPin = pin;
        rememberPin(pin);

        if (adminPinInput) adminPinInput.value = "";

        showAdmin();
        await loadOrders(true);
      } catch (error) {
        if (loginError) {
          loginError.textContent = error.message;
          loginError.style.display = "block";
        } else {
          alert(error.message);
        }
      } finally {
        loggingIn = false;
        if (button) button.disabled = false;
      }
    });

    $("#btnLogout")?.addEventListener("click", () => {
      if (isBusy()) {
        alert(
          "Tunggu proses database selesai terlebih dahulu."
        );
        return;
      }

      if (confirm("Keluar dari panel admin?")) {
        showLogin();
      }
    });

    // ===================================================
    // LOAD DATABASE
    // ===================================================
    async function loadOrders(notify = true) {
      if (!adminPin || loading || writing) return false;

      loading = true;

      if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.setAttribute("aria-busy", "true");
      }

      renderDashboard();

      let success = false;

      try {
        const data = await api("adminOrders");

        if (!Array.isArray(data.orders)) {
          throw new Error(
            "Format daftar pesanan tidak sesuai."
          );
        }

        orders = data.orders.filter(
          order => order && order.id
        );

        success = true;
      } catch (error) {
        console.error(
          "Gagal memuat pesanan:",
          error
        );

        if (notify) {
          alert(
            "Gagal memuat data terbaru:\n" +
            error.message +
            "\n\nData yang sudah tampil mungkin belum terbaru."
          );
        }
      } finally {
        loading = false;

        if (refreshButton) {
          refreshButton.disabled = false;
          refreshButton.removeAttribute("aria-busy");
        }

        renderDashboard();
      }

      return success;
    }

    // ===================================================
    // CLOCK
    // ===================================================
    function updateClock() {
      setText(
        "#liveClock",
        new Date().toLocaleTimeString("id-ID", {
          timeZone: "Asia/Jakarta",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }) + " WIB"
      );
    }

    updateClock();
    setInterval(updateClock, 1000);

    // ===================================================
    // STATUS / MAP HELPERS
    // ===================================================
    function getStatusClass(status) {
      const classes = {
        "Menunggu Penjemputan": "status-pending",
        "Sedang Dijemput": "status-pickup",
        "Sedang Dicuci": "status-wash",
        "Sedang Disetrika": "status-iron",
        "Siap Diantar": "status-deliver",
        "Selesai": "status-done",
        "Dibatalkan": "status-cancel"
      };

      return classes[status] || "status-pending";
    }

    function mapLink(order) {
      if (
        order.lat !== "" &&
        order.lng !== "" &&
        order.lat != null &&
        order.lng != null
      ) {
        const lat = Number(order.lat);
        const lng = Number(order.lng);

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
        ) {
          return (
            "https://www.google.com/maps?q=" +
            `${lat},${lng}`
          );
        }
      }

      try {
        const url = new URL(
          String(order.gmapsLink || "")
        );

        if (
          url.protocol === "https:" &&
          [
            "www.google.com",
            "maps.google.com",
            "maps.app.goo.gl"
          ].includes(url.hostname)
        ) {
          return url.href;
        }
      } catch {}

      return "";
    }

    // ===================================================
    // DASHBOARD PEMASUKAN
    // ===================================================
    function jakartaDateKey() {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date());

      const get = type =>
        parts.find(part => part.type === type)?.value;

      return `${get("year")}-${get("month")}-${get("day")}`;
    }

    function orderDateKey(createdAt) {
      const match = String(createdAt || "")
        .trim()
        .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D|$)/);

      if (!match) return "";

      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);

      const date = new Date(Date.UTC(year, month - 1, day));

      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        return "";
      }

      return (
        `${year}-` +
        `${String(month).padStart(2, "0")}-` +
        String(day).padStart(2, "0")
      );
    }

    function displayIncomeDate(key) {
      const [year, month, day] = key.split("-").map(Number);

      return new Intl.DateTimeFormat("id-ID", {
        timeZone: "UTC",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      }).format(new Date(Date.UTC(year, month - 1, day)));
    }

    function displayIncomeMonth(key) {
      const [year, month] = key.split("-").map(Number);

      return new Intl.DateTimeFormat("id-ID", {
        timeZone: "UTC",
        month: "long",
        year: "numeric"
      }).format(new Date(Date.UTC(year, month - 1, 1)));
    }

    function getRecordedPaymentTotal(order) {
      const payment = splitPaymentNote(order.note);

      if (!payment.paymentText) return null;

      const text = payment.paymentText;

      if (!/^Status pembayaran:\s*LUNAS\s*$/im.test(text)) {
        return null;
      }

      const match = text.match(
        /^Total tagihan:\s*Rp\s*([0-9.]+)\s*$/im
      );

      if (!match) return null;

      const digits = match[1].replace(/\./g, "");
      const amount = Number(digits);

      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return null;
      }

      return amount;
    }

 function renderIncomeDashboard() {
  const dateInput = $("#incomeDate");
  const monthInput = $("#incomeMonth");
  const rangeStartInput = $("#incomeRangeStart");
  const rangeEndInput = $("#incomeRangeEnd");
  const dailyList = $("#incomeDailyList");

  if (
    !dateInput ||
    !monthInput ||
    !rangeStartInput ||
    !rangeEndInput ||
    !dailyList
  ) {
    return;
  }

  const today = jakartaDateKey();

  if (!dateInput.value) dateInput.value = today;

  if (!monthInput.value) {
    monthInput.value = today.slice(0, 7);
  }

  if (!rangeStartInput.value) {
    rangeStartInput.value = today;
  }

  if (!rangeEndInput.value) {
    rangeEndInput.value = today;
  }

  const selectedDate = dateInput.value;
  const selectedMonth = monthInput.value;

  // Jika tanggal awal dan akhir tertukar,
  // sistem otomatis mengurutkannya.
  let rangeStart = rangeStartInput.value;
  let rangeEnd = rangeEndInput.value;

  if (rangeStart > rangeEnd) {
    [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
  }

  let dayTotal = 0;
  let monthTotal = 0;
  let rangeTotal = 0;

  let withoutPayment = 0;
  let invalidDateCount = 0;
  let cancelledPaidCount = 0;

  const daily = new Map();

  orders.forEach(order => {
    const amount = getRecordedPaymentTotal(order);

    if (amount === null) {
      withoutPayment += 1;
      return;
    }

    const dateKey = orderDateKey(order.createdAt);

    if (!dateKey) {
      invalidDateCount += 1;
      return;
    }

    if (order.status === "Dibatalkan") {
      cancelledPaidCount += 1;
    }

    if (dateKey === selectedDate) {
      dayTotal += amount;
    }

    if (dateKey.slice(0, 7) === selectedMonth) {
      monthTotal += amount;

      const entry = daily.get(dateKey) || {
        total: 0,
        count: 0
      };

      entry.total += amount;
      entry.count += 1;

      daily.set(dateKey, entry);
    }

    // Rentang tanggal: awal dan akhir ikut dihitung.
    if (
      dateKey >= rangeStart &&
      dateKey <= rangeEnd
    ) {
      rangeTotal += amount;
    }
  });

  setText(
    "#incomeDayLabel",
    displayIncomeDate(selectedDate)
  );

  setText("#incomeDayTotal", rupiah(dayTotal));

  setText(
    "#incomeMonthLabel",
    displayIncomeMonth(selectedMonth)
  );

  setText("#incomeMonthTotal", rupiah(monthTotal));

  setText(
    "#incomeRangeLabel",
    `Pemasukan ${displayIncomeDate(rangeStart)} — ${displayIncomeDate(rangeEnd)}`
  );

  setText("#incomeRangeTotal", rupiah(rangeTotal));

  setText(
    "#incomeRecapPeriod",
    displayIncomeMonth(selectedMonth)
  );

  const entries = Array.from(daily.entries())
    .sort(([dateA], [dateB]) =>
      dateB.localeCompare(dateA)
    );

  dailyList.innerHTML = entries.length
    ? entries.map(([dateKey, entry]) => `
        <div class="income-day-row">
          <div>
            <b>
              ${escapeHtml(
                displayIncomeDate(dateKey)
              )}
            </b>
            <small>${entry.count} pesanan</small>
          </div>
          <strong>
            ${escapeHtml(rupiah(entry.total))}
          </strong>
        </div>
      `).join("")
    : `
        <p class="income-empty">
          Belum ada pembayaran kasir tercatat pada bulan ini.
        </p>
      `;

  const notices = [
    "Rekap memakai tanggal pembuatan pesanan, bukan tanggal pembayaran terpisah.",
    `${withoutPayment} pesanan tidak dihitung karena tidak memiliki catatan pembayaran kasir yang dapat dibaca.`,
    "Filter rentang tanggal menghitung tanggal awal dan tanggal akhir."
  ];

  if (invalidDateCount) {
    notices.push(
      `${invalidDateCount} pesanan lunas memiliki tanggal yang tidak terbaca, sehingga tidak masuk rekap.`
    );
  }

  if (cancelledPaidCount) {
    notices.push(
      `${cancelledPaidCount} pesanan berstatus Dibatalkan masih memiliki catatan lunas dan tetap dihitung.`
    );
  }

  setText("#incomeNotice", notices.join(" "));
}
    // ===================================================
    // DASHBOARD / TABLE
    // ===================================================
    function renderDashboard() {
      renderIncomeDashboard();

      setText("#metricTotal", orders.length);

      setText(
        "#metricPending",
        orders.filter(
          order =>
            order.status === "Menunggu Penjemputan"
        ).length
      );

      setText(
        "#metricProcess",
        orders.filter(order =>
          [
            "Sedang Dijemput",
            "Sedang Dicuci",
            "Sedang Disetrika",
            "Siap Diantar"
          ].includes(order.status)
        ).length
      );

      setText(
        "#metricCompleted",
        orders.filter(
          order => order.status === "Selesai"
        ).length
      );

      if (!tableBody) return;

      const search = value(
        "#searchInput"
      ).toLowerCase();

      const filter = filterStatus?.value || "ALL";

      const filtered = orders.filter(order => {
        const matchesSearch = [
          "id",
          "name",
          "phone",
          "address",
          "service"
        ].some(key =>
          String(order[key] ?? "")
            .toLowerCase()
            .includes(search)
        );

        const matchesStatus =
          filter === "ALL" ||
          order.status === filter;

        return matchesSearch && matchesStatus;
      });

      if (!filtered.length) {
        tableBody.innerHTML = "";

        if (emptyState) {
          emptyState.style.display = "block";

          emptyState.textContent = loading
            ? "Sedang mengambil data dari Google Sheets..."
            : "Tidak ada pesanan yang cocok.";
        }

        return;
      }

      if (emptyState) {
        emptyState.style.display = "none";
      }

      tableBody.innerHTML = filtered.map(order => {
        const id = escapeHtml(order.id);
        const phone = String(order.phone || "");
        const digits = phone.replace(/\D/g, "");

        const waNumber = digits.startsWith("0")
          ? "62" + digits.slice(1)
          : digits;

        const waText = encodeURIComponent(
          `Halo Kak ${order.name}, update pesanan ` +
          `Yoga Laundry #${order.id}: status saat ini ` +
          `${order.status}.`
        );

        const maps = mapLink(order);

        const disabled = isBusy()
          ? "disabled"
          : "";

        return `
          <tr class="order-summary-card" data-id="${id}">
            <td class="order-summary-cell">
              <button
                type="button"
                class="order-summary-toggle"
                data-action="toggle"
                aria-expanded="false"
              >
                <span class="order-summary-top">
                  <span class="order-summary-id">#${id}</span>
                  <span
                    class="order-summary-hint"
                    aria-hidden="true"
                  ></span>
                </span>

                <span class="order-summary-name">
                  ${escapeHtml(order.name)}
                </span>

                <span class="order-summary-service">
                  ${escapeHtml(order.service)}
                  · ${escapeHtml(order.weight || "-")}
                </span>

                <span
                  class="order-summary-status ${getStatusClass(
                    order.status
                  )}"
                >
                  ${escapeHtml(order.status)}
                </span>
              </button>
            </td>

            <td style="font-size:11px;white-space:nowrap;">
              ${escapeHtml(order.createdAt)}
            </td>

            <td>
              <span class="cust-name">
                ${escapeHtml(order.name)}
              </span>

              <a
                class="cust-phone"
                href="https://wa.me/${waNumber}"
                target="_blank"
                rel="noopener noreferrer"
              >${escapeHtml(phone)}</a>
            </td>

            <td style="max-width:220px;font-size:12px;">
              ${escapeHtml(order.address)}

              ${
                maps
                  ? `
                    <a
                      href="${escapeHtml(maps)}"
                      class="admin-loc-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >Buka di Maps</a>
                  `
                  : ""
              }
            </td>

            <td>
              <span class="order-service-name">
                ${escapeHtml(order.service)}
              </span>

              <span class="order-weight">
                ${escapeHtml(order.weight || "-")}
                ·
                ${escapeHtml(
                  order.priceEstimate || "Tanya Harga"
                )}
              </span>
            </td>

            <td
              style="max-width:180px;font-size:11px;white-space:pre-line;"
            >${escapeHtml(order.note || "-")}</td>

            <td>
              <select
                data-action="status"
                class="status-dropdown ${getStatusClass(
                  order.status
                )}"
                ${disabled}
              >
                ${STATUSES.map(status => `
                  <option
                    value="${escapeHtml(status)}"
                    ${
                      order.status === status
                        ? "selected"
                        : ""
                    }
                  >${escapeHtml(status)}</option>
                `).join("")}
              </select>
            </td>

            <td>
              <div class="row-actions">
                <button
                  type="button"
                  class="btn-icon"
                  data-action="receipt"
                >Struk</button>

                <button
                  type="button"
                  class="btn-icon"
                  data-action="edit"
                  ${disabled}
                >Edit</button>

                <a
                  class="btn-icon btn-icon-wa"
                  href="https://wa.me/${waNumber}?text=${waText}"
                  target="_blank"
                  rel="noopener noreferrer"
                >WA</a>

                <button
                  type="button"
                  class="btn-icon btn-icon-del"
                  data-action="delete"
                  ${disabled}
                >Hapus</button>
              </div>
            </td>
          </tr>
        `;
      }).join("");
    }

    // ===================================================
    // UPDATE / DELETE DATABASE
    // ===================================================
    async function mutate(action, payload) {
      if (writing || loading || !adminPin) {
        return false;
      }

      writing = true;
      renderDashboard();

      let success = false;

      try {
        await api(action, payload);
        success = true;

        if (action === "createOrder") {
          const order = payload.order;

          if (!findOrder(order.id)) {
            orders.unshift(order);
          }
        }

        if (action === "updateOrder") {
          const order = findOrder(payload.id);

          if (order) {
            Object.assign(order, payload.changes);
          }
        }

        if (action === "deleteOrder") {
          orders = orders.filter(
            order =>
              String(order.id) !== String(payload.id)
          );
        }
      } catch (error) {
        alert(
          "Perubahan belum terkonfirmasi:\n" +
          error.message +
          "\n\nPeriksa data terbaru sebelum mencoba lagi."
        );
      } finally {
        writing = false;
        await loadOrders(true);
      }

      return success;
    }

    async function updateStatus(id, status) {
      if (isBusy()) return;
      if (!STATUSES.includes(status)) return;

      await mutate("updateOrder", {
        id,
        changes: { status }
      });
    }

    async function deleteOrder(id) {
      if (isBusy()) return;

      const order = findOrder(id);
      const hasPayment = Boolean(
        splitPaymentNote(order?.note).paymentText
      );

      const message =
        `Hapus pesanan #${id} dari Google Sheets?\n` +
        "Baris pesanan juga dihapus dari database." +
        (
          hasPayment
            ? "\n\nPesanan ini memiliki catatan pembayaran. " +
              "Menghapus pesanan tidak mengembalikan uang pelanggan."
            : ""
        );

      if (!confirm(message)) return;

      await mutate("deleteOrder", { id });
    }

    // ===================================================
    // EDIT ORDER
    // ===================================================
    async function editOrder(id) {
      if (isBusy()) return;

      const order = findOrder(id);
      if (!order) return;

      const payment = splitPaymentNote(order.note);
      const hasPayment = Boolean(payment.paymentText);

      const fields = hasPayment
        ? [
            ["name", "Nama pelanggan"],
            ["phone", "Nomor WhatsApp"],
            ["address", "Alamat / keterangan pengantaran"],
            ["note", "Catatan khusus pelanggan"]
          ]
        : [
            ["name", "Nama pelanggan"],
            ["phone", "Nomor WhatsApp"],
            ["address", "Alamat penjemputan"],
            ["service", "Nama layanan"],
            ["weight", "Berat / jumlah"],
            ["note", "Catatan"],
            ["priceEstimate", "Estimasi biaya"]
          ];

      if (hasPayment) {
        alert(
          "Pesanan ini memiliki pembayaran kasir.\n\n" +
          "Edit di sini hanya mengubah data pelanggan " +
          "dan catatan khusus. Layanan, berat, tarif, " +
          "dan rincian pembayaran tetap dipertahankan."
        );
      }

      const changes = {};

      for (const [key, label] of fields) {
        const original =
          key === "note" && hasPayment
            ? payment.customerNote
            : String(order[key] ?? "");

        const input = prompt(label, original);

        if (input === null) return;

        const next = input.trim();

        if (
          ["name", "phone", "address", "service"]
            .includes(key) &&
          !next
        ) {
          alert(
            `${label} tidak boleh kosong. Edit dibatalkan.`
          );
          return;
        }

        if (next !== original) {
          if (key === "note" && hasPayment) {
            changes.note = [
              next,
              PAYMENT_MARKER + "\n" + payment.paymentText
            ].filter(Boolean).join("\n\n");
          } else {
            changes[key] = next;
          }
        }
      }

      if (!Object.keys(changes).length) return;

      if (!confirm(
        `Simpan perubahan pesanan #${id} ke Google Sheets?`
      )) {
        return;
      }

      await mutate("updateOrder", {
        id,
        changes
      });
    }

    // ===================================================
    // TABLE EVENTS
    // ===================================================
    tableBody?.addEventListener("click", event => {
      const button = event.target.closest(
        "button[data-action]"
      );

      if (!button || button.disabled) return;

      const row = button.closest("tr");
      const id = row?.dataset.id;

      if (!id) return;

      const action = button.dataset.action;

      if (action === "toggle") {
        const expanded =
          row.classList.toggle("is-expanded");

        button.setAttribute(
          "aria-expanded",
          String(expanded)
        );

        return;
      }

      if (action === "receipt") {
        showReceiptModal(id);
      }

      if (action === "edit") {
        editOrder(id);
      }

      if (action === "delete") {
        deleteOrder(id);
      }
    });

    tableBody?.addEventListener("change", event => {
      if (!event.target.matches(
        'select[data-action="status"]'
      )) {
        return;
      }

      const id = event.target.closest("tr")?.dataset.id;

      if (id) {
        updateStatus(id, event.target.value);
      }
    });

    // ===================================================
    // RECEIPT
    // ===================================================
    function showReceiptModal(id, fallbackOrder = null) {
      const order = findOrder(id) || fallbackOrder;

      if (!order || !receiptPrintArea) return;

      const maps = mapLink(order);
      const payment = splitPaymentNote(order.note);

      const rows = [
        [
          "Pelanggan",
          `${order.name} (${order.phone})`
        ],
        ["Alamat", order.address],
        ["Paket Layanan", order.service],
        ["Berat / Jumlah", order.weight || "-"],
        [
          "Tarif / Estimasi",
          order.priceEstimate || "Sesuai Timbangan"
        ],
        [
          "Catatan Khusus",
          payment.customerNote || "-"
        ],
        ["Status Cucian", order.status]
      ];

      receiptPrintArea.innerHTML = `
        <div class="receipt-paper">
          <div class="receipt-header">
            <h4>YOGA LAUNDRY</h4>
            <p>WhatsApp: 0823-2056-5949</p>
            <p>Buka Setiap Hari: 08.00 - 23.00 WIB</p>
          </div>

          <div class="receipt-meta">
            <span>
              NO. RESI:
              <b>#${escapeHtml(order.id)}</b>
            </span>
            <span>${escapeHtml(order.createdAt)}</span>
          </div>

          <div class="receipt-divider"></div>

          <div class="receipt-details">
            ${rows.map(([label, text]) => `
              <div class="receipt-row">
                <span>${escapeHtml(label)}</span>
                <span style="white-space:pre-line;">${escapeHtml(text)}</span>
              </div>
            `).join("")}

            ${
              maps
                ? `
                  <div class="receipt-row">
                    <span>Lokasi</span>
                    <span>
                      <a
                        href="${escapeHtml(maps)}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >Buka Google Maps</a>
                    </span>
                  </div>
                `
                : ""
            }
          </div>

          ${
            payment.paymentText
              ? `
                <div class="receipt-divider"></div>

                <div
                  style="
                    margin:10px 0;
                    font-size:11px;
                    font-weight:700;
                    color:#10233c;
                  "
                >
                  RINCIAN PEMBAYARAN
                </div>

                <div
                  style="
                    white-space:pre-line;
                    overflow-wrap:anywhere;
                    font-size:11px;
                    line-height:1.8;
                  "
                >${escapeHtml(payment.paymentText)}</div>
              `
              : ""
          }

          <div class="receipt-footer">
            <p>
              Terima kasih telah mempercayakan cucian Anda
              kepada Yoga Laundry.
            </p>
            <p>Simpan struk ini sebagai bukti pesanan.</p>
          </div>
        </div>
      `;

      show(receiptModal);
    }

    [
      "#btnCloseReceipt",
      "#btnCloseReceipt2"
    ].forEach(selector => {
      $(selector)?.addEventListener("click", () => {
        hide(receiptModal);
      });
    });

    $("#btnPrintReceipt")?.addEventListener(
      "click",
      () => window.print()
    );

    // ===================================================
    // CASHIER CALCULATION
    // ===================================================
    function getCashierValues() {
      const service = value("#manualService");
      const rate = SERVICE_RATES[service] || 0;

      const weightInput = $("#manualWeight");
      const cashInput = $("#manualCash");

      const weight = weightInput?.valueAsNumber;

      const cashDigits = String(cashInput?.value || "")
        .replace(/\./g, "")
        .trim();

      const cash = /^\d+$/.test(cashDigits)
        ? Number(cashDigits)
        : NaN;

      const validWeight = Boolean(
        weightInput &&
        Number.isFinite(weight) &&
        weight > 0 &&
        weightInput.checkValidity()
      );

      const validCash = Boolean(
        cashInput &&
        Number.isFinite(cash) &&
        Number.isSafeInteger(cash) &&
        cash >= 0 &&
        cashInput.checkValidity()
      );

      const hundredths = validWeight
        ? Math.round(weight * 100)
        : 0;

      const total = validWeight
        ? Math.round((hundredths * rate) / 100)
        : 0;

      return {
        service,
        rate,
        weight,
        cash,
        total,
        validWeight,
        validCash,
        change: validCash ? cash - total : 0
      };
    }

    function renderCashier() {
      const bill = getCashierValues();

      setText(
        "#cashierRate",
        rupiah(bill.rate)
      );

      setText(
        "#cashierWeight",
        bill.validWeight
          ? `${bill.weight.toLocaleString("id-ID")} kg`
          : "0 kg"
      );

      setText(
        "#cashierTotal",
        rupiah(bill.total)
      );

      const short =
        bill.validWeight &&
        bill.validCash &&
        bill.cash < bill.total;

      const changeBox = $("#cashierChange")
        ?.closest(".cashier-change");

      changeBox?.classList.toggle(
        "is-short",
        short
      );

      setText(
        "#cashierChangeLabel",
        short ? "Uang masih kurang" : "Kembalian"
      );

      setText(
        "#cashierChange",
        bill.validWeight && bill.validCash
          ? rupiah(Math.abs(bill.change))
          : rupiah(0)
      );

      let message =
        "Masukkan berat dan uang pelanggan.";

      if (!bill.rate) {
        message =
          "Layanan ini belum memiliki tarif kasir.";
      } else if (!bill.validWeight) {
        message =
          "Masukkan berat lebih dari 0, maksimal dua angka desimal.";
      } else if (!bill.validCash) {
        message =
          "Masukkan uang tunai yang diterima. Titik ribuan ditambahkan otomatis.";
      } else if (short) {
        message =
          "Uang belum cukup. Pesanan belum bisa disimpan sebagai lunas.";
      } else {
        message =
          "Pembayaran cukup. Pesanan siap disimpan sebagai lunas.";
      }

      setText(
        "#cashierMessage",
        message
      );
    }

    $("#manualService")?.addEventListener(
      "change",
      renderCashier
    );

    $("#manualWeight")?.addEventListener(
      "input",
      renderCashier
    );

    $("#manualCash")?.addEventListener("input", event => {
      const input = event.target;

      const cursor =
        input.selectionStart ?? input.value.length;

      const digitsOnRight = input.value
        .slice(cursor)
        .replace(/\D/g, "")
        .length;

      const digits = input.value
        .replace(/\D/g, "")
        .replace(/^0+(?=\d)/, "");

      input.value = digits.replace(
        /\B(?=(\d{3})+(?!\d))/g,
        "."
      );

      let position = input.value.length;
      let remaining = digitsOnRight;

      while (position > 0 && remaining > 0) {
        position -= 1;

        if (/\d/.test(input.value[position])) {
          remaining -= 1;
        }
      }

      input.setSelectionRange(position, position);

      renderCashier();
    });

    manualOrderForm?.addEventListener("reset", () => {
      setTimeout(renderCashier, 0);
    });

    // ===================================================
    // OPEN / CLOSE MANUAL ORDER
    // ===================================================
    $("#btnNewManualOrder")?.addEventListener(
      "click",
      () => {
        if (isBusy()) return;

        if (!manualOrderForm || !$("#manualCash")) {
          alert(
            "HTML kasir belum lengkap. Gunakan admin.html " +
            "terbaru yang memiliki input manualCash."
          );
          return;
        }

        if (!pendingManualOrder) {
          manualOrderForm.reset();
          pendingManualSignature = "";
        }

        renderCashier();
        show(manualModal);
        $("#manualName")?.focus();
      }
    );

    function closeManualModal() {
      if (writing || manualSubmitting) return;
      hide(manualModal);
    }

    [
      "#btnCloseManual",
      "#btnCancelManual"
    ].forEach(selector => {
      $(selector)?.addEventListener(
        "click",
        closeManualModal
      );
    });

    // ===================================================
    // SAVE MANUAL ORDER + CASHIER
    // ===================================================
    manualOrderForm?.addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        if (isBusy() || !adminPin) return;

        if (!$("#manualCash")) {
          alert(
            "Input uang tunai belum tersedia pada HTML admin."
          );
          return;
        }

        if (!manualOrderForm.reportValidity()) return;

        const bill = getCashierValues();

        if (
          !bill.rate ||
          !bill.validWeight ||
          !Number.isSafeInteger(bill.total) ||
          bill.total <= 0
        ) {
          alert(
            "Pilih layanan dan masukkan berat cucian yang valid."
          );
          return;
        }

        if (
          !bill.validCash ||
          bill.cash < bill.total
        ) {
          alert(
            "Uang pelanggan belum cukup atau belum diisi dengan benar."
          );
          $("#manualCash")?.focus();
          return;
        }

        const name = value("#manualName");
        const phone = value("#manualPhone");
        const address = value("#manualAddress");
        const customerNote = value("#manualNote");

        if (!name || !phone || !address) {
          alert(
            "Nama, nomor WhatsApp, dan alamat/keterangan wajib diisi."
          );
          return;
        }

        if (customerNote.includes(PAYMENT_MARKER)) {
          alert(
            "Catatan pelanggan tidak boleh memakai penanda pembayaran sistem."
          );
          return;
        }

        const paymentText = [
          "Status pembayaran: LUNAS",
          "Metode: Tunai",
          `Tarif: ${rupiah(bill.rate)} / kg`,
          `Berat: ${bill.weight.toLocaleString("id-ID")} kg`,
          `Total tagihan: ${rupiah(bill.total)}`,
          `Uang diterima: ${rupiah(bill.cash)}`,
          `Kembalian: ${rupiah(bill.change)}`
        ].join("\n");

        const finalNote = [
          customerNote,
          PAYMENT_MARKER + "\n" + paymentText
        ].filter(Boolean).join("\n\n");

        const fields = {
          name,
          phone,
          address,
          service: bill.service,
          weight:
            `${bill.weight.toLocaleString("id-ID")} kg`,
          note: finalNote,
          lat: null,
          lng: null,
          gmapsLink: null,
          priceEstimate: priceFor(bill.service),
          status: "Menunggu Penjemputan"
        };

        const signature = JSON.stringify(fields);

        if (
          !pendingManualOrder ||
          signature !== pendingManualSignature
        ) {
          if (pendingManualOrder) {
            const proceed = confirm(
              "Isian berubah setelah percobaan penyimpanan sebelumnya.\n\n" +
              `Resi sebelumnya: ${pendingManualOrder.id}\n\n` +
              "Pastikan resi itu belum tersimpan di database, " +
              "agar tidak membuat pesanan ganda.\n\n" +
              "Lanjut membuat nomor resi baru?"
            );

            if (!proceed) return;
          }

          pendingManualOrder = {
            id: newId(),
            createdAt: orderTime(),
            ...fields
          };

          pendingManualSignature = signature;
        }

        const order = pendingManualOrder;

        manualSubmitting = true;
        manualOrderForm.setAttribute(
          "aria-busy",
          "true"
        );

        const controls = Array.from(
          manualOrderForm.elements
        );

        const previous = controls.map(
          control => control.disabled
        );

        controls.forEach(control => {
          control.disabled = true;
        });

        let success = false;

        try {
          success = await mutate(
            "createOrder",
            { order }
          );
        } finally {
          controls.forEach((control, index) => {
            control.disabled = previous[index];
          });

          manualSubmitting = false;
          manualOrderForm.removeAttribute("aria-busy");
          renderDashboard();
        }

        if (!success) {
          alert(
            "Formulir tetap disimpan di halaman ini.\n\n" +
            `Nomor resi percobaan: ${order.id}\n\n` +
            "Cek daftar pesanan terlebih dahulu sebelum " +
            "mencoba kembali. Jangan tutup halaman jika " +
            "ingin mempertahankan isian percobaan ini."
          );
          return;
        }

        hide(manualModal);

        pendingManualOrder = null;
        pendingManualSignature = "";

        manualOrderForm.reset();
        renderCashier();

        showReceiptModal(order.id, order);
      }
    );

    // ===================================================
    // SEARCH / REFRESH / MODAL EVENTS
    // ===================================================
    searchInput?.addEventListener(
      "input",
      renderDashboard
    );

    filterStatus?.addEventListener(
      "change",
      renderDashboard
    );

    refreshButton?.addEventListener(
      "click",
      event => {
        event.preventDefault();

        if (manualSubmitting) return;

        loadOrders(true);
      }
    );

    window.addEventListener("click", event => {
      if (
        receiptModal &&
        event.target === receiptModal
      ) {
        hide(receiptModal);
      }

      if (
        manualModal &&
        event.target === manualModal
      ) {
        closeManualModal();
      }
    });

    window.updateStatus = updateStatus;
    window.deleteOrder = deleteOrder;
    window.showReceiptModal = showReceiptModal;
    window.editOrder = editOrder;

    // ===================================================
    // STARTUP
    // ===================================================
    async function boot() {
      renderCashier();

      const savedPin = getSessionPin();

      if (!savedPin) {
        showLogin();
        return;
      }

      try {
        await api(
          "adminLogin",
          {},
          savedPin
        );

        adminPin = savedPin;

        showAdmin();
        await loadOrders(true);
      } catch (error) {
        showLogin();

        if (loginError) {
          loginError.textContent =
            "Silakan login kembali. " +
            error.message;

          loginError.style.display = "block";
        }
      }
    }

    boot();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }
})();
