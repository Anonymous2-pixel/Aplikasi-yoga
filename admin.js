// ===================================================
// YOGA LAUNDRY - ADMIN DASHBOARD
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
    let pendingManualOrder = null;
    let pendingManualSignature = "";

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

        // Hapus penanda login versi lama.
        sessionStorage.removeItem("yoga_admin_auth");
      } catch (error) {
        console.warn("Penyimpanan sesi tidak tersedia:", error);
      }
    }

    async function api(action, payload = {}, pin = adminPin) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

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
          throw new Error(`HTTP ${response.status}`);
        }

        let data;

        try {
          data = await response.json();
        } catch {
          throw new Error(
            "Respons bukan JSON. Periksa deployment Apps Script."
          );
        }

        if (data.ok !== true) {
          throw new Error(
            data.message || "Database belum mengonfirmasi permintaan."
          );
        }

        return data;
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error(
            "Waktu tunggu habis. Muat ulang data sebelum mengulangi perubahan."
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
      rememberPin("");

      hide(adminApp);
      show(loginOverlay);
      hide(receiptModal);
      hide(manualModal);

      if (tableBody) tableBody.innerHTML = "";
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
      const button = loginForm.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      if (loginError) loginError.style.display = "none";

      try {
        await api("adminLogin", {}, pin);

        adminPin = pin;
        rememberPin(pin);
        adminPinInput.value = "";

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
      if (writing || loading) {
        alert("Tunggu proses database selesai terlebih dahulu.");
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
      if (!adminPin || loading || writing) return;

      loading = true;

      if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.setAttribute("aria-busy", "true");
      }

      renderDashboard();

      try {
        const data = await api("adminOrders");

        if (!Array.isArray(data.orders)) {
          throw new Error("Format daftar pesanan tidak sesuai.");
        }

        orders = data.orders.filter(order => order && order.id);
      } catch (error) {
        console.error("Gagal memuat pesanan:", error);

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
          return `https://www.google.com/maps?q=${lat},${lng}`;
        }
      }

      try {
        const url = new URL(String(order.gmapsLink || ""));

        if (
          url.protocol === "https:" &&
          ["www.google.com", "maps.google.com", "maps.app.goo.gl"]
            .includes(url.hostname)
        ) {
          return url.href;
        }
      } catch {}

      return "";
    }

    // ===================================================
    // TABLE AND METRICS
    // ===================================================
    function renderDashboard() {
      setText("#metricTotal", orders.length);
      setText(
        "#metricPending",
        orders.filter(o => o.status === "Menunggu Penjemputan").length
      );
      setText(
        "#metricProcess",
        orders.filter(o =>
          [
            "Sedang Dijemput",
            "Sedang Dicuci",
            "Sedang Disetrika",
            "Siap Diantar"
          ].includes(o.status)
        ).length
      );
      setText(
        "#metricCompleted",
        orders.filter(o => o.status === "Selesai").length
      );

      if (!tableBody) return;

      const search = value("#searchInput").toLowerCase();
      const filter = filterStatus?.value || "ALL";

      const filtered = orders.filter(order => {
        const matchesSearch = [
          "id", "name", "phone", "address", "service"
        ].some(key =>
          String(order[key] ?? "").toLowerCase().includes(search)
        );

        return (
          matchesSearch &&
          (filter === "ALL" || order.status === filter)
        );
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

      if (emptyState) emptyState.style.display = "none";

      tableBody.innerHTML = filtered.map(order => {
        const id = escapeHtml(order.id);
        const phone = String(order.phone || "");
        const digits = phone.replace(/\D/g, "");
        const waNumber = digits.startsWith("0")
          ? "62" + digits.slice(1)
          : digits;

        const waText = encodeURIComponent(
          `Halo Kak ${order.name}, update pesanan Yoga Laundry ` +
          `#${order.id}: status saat ini ${order.status}.`
        );

        const maps = mapLink(order);
        const disabled = loading || writing ? "disabled" : "";

        return `
          <tr data-id="${id}">
            <td>
              <button
                type="button"
                class="resi-badge"
                data-action="receipt"
              >#${id}</button>
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
                  ? `<a
                      href="${escapeHtml(maps)}"
                      class="admin-loc-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >Buka di Maps</a>`
                  : ""
              }
            </td>

            <td>
              <span class="order-service-name">
                ${escapeHtml(order.service)}
              </span>
              <span class="order-weight">
                ${escapeHtml(order.weight || "-")}
                · ${escapeHtml(order.priceEstimate || "Tanya Harga")}
              </span>
            </td>

            <td style="max-width:180px;font-size:11px;">
              ${escapeHtml(order.note || "-")}
            </td>

            <td>
              <select
                data-action="status"
                class="status-dropdown ${getStatusClass(order.status)}"
                ${disabled}
              >
                ${STATUSES.map(status => `
                  <option
                    value="${escapeHtml(status)}"
                    ${order.status === status ? "selected" : ""}
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
      if (writing || loading || !adminPin) return false;

      writing = true;
      renderDashboard();

      let success = false;

      try {
        await api(action, payload);
        success = true;
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
      if (!STATUSES.includes(status)) return;

      await mutate("updateOrder", {
        id,
        changes: { status }
      });
    }

    async function deleteOrder(id) {
      if (!confirm(
        `Hapus pesanan #${id} dari Google Sheets?\n` +
        "Baris pesanan juga dihapus dari database."
      )) return;

      await mutate("deleteOrder", { id });
    }

    async function editOrder(id) {
      if (loading || writing) return;

      const order = orders.find(item => String(item.id) === String(id));
      if (!order) return;

      const fields = [
        ["name", "Nama pelanggan"],
        ["phone", "Nomor WhatsApp"],
        ["address", "Alamat penjemputan"],
        ["service", "Nama layanan"],
        ["weight", "Berat / jumlah"],
        ["note", "Catatan"],
        ["priceEstimate", "Estimasi biaya"]
      ];

      const changes = {};

      for (const [key, label] of fields) {
        const input = prompt(label, String(order[key] ?? ""));
        if (input === null) return;

        const next = input.trim();

        if (
          ["name", "phone", "address", "service"].includes(key) &&
          !next
        ) {
          alert(`${label} tidak boleh kosong. Edit dibatalkan.`);
          return;
        }

        if (next !== String(order[key] ?? "")) {
          changes[key] = next;
        }
      }

      if (!Object.keys(changes).length) return;

      if (!confirm(`Simpan perubahan pesanan #${id} ke Google Sheets?`)) {
        return;
      }

      await mutate("updateOrder", { id, changes });
    }

    tableBody?.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const id = button.closest("tr")?.dataset.id;
      if (!id) return;

      const action = button.dataset.action;

      if (action === "receipt") showReceiptModal(id);
      if (action === "edit") editOrder(id);
      if (action === "delete") deleteOrder(id);
    });

    tableBody?.addEventListener("change", event => {
      if (!event.target.matches('select[data-action="status"]')) return;

      const id = event.target.closest("tr")?.dataset.id;
      if (id) updateStatus(id, event.target.value);
    });

    // ===================================================
    // RECEIPT
    // ===================================================
    function showReceiptModal(id) {
      const order = orders.find(item => String(item.id) === String(id));
      if (!order || !receiptPrintArea) return;

      const maps = mapLink(order);

      const rows = [
        ["Pelanggan", `${order.name} (${order.phone})`],
        ["Alamat", order.address],
        ["Paket Layanan", order.service],
        ["Estimasi Jumlah", order.weight || "-"],
        ["Catatan Khusus", order.note || "-"],
        ["Estimasi Biaya", order.priceEstimate || "Sesuai Timbangan"],
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
            <span>NO. RESI: <b>#${escapeHtml(order.id)}</b></span>
            <span>${escapeHtml(order.createdAt)}</span>
          </div>

          <div class="receipt-divider"></div>

          <div class="receipt-details">
            ${rows.map(([label, text]) => `
              <div class="receipt-row">
                <span>${escapeHtml(label)}</span>
                <span>${escapeHtml(text)}</span>
              </div>
            `).join("")}

            ${
              maps
                ? `<div class="receipt-row">
                    <span>Lokasi</span>
                    <span>
                      <a
                        href="${escapeHtml(maps)}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >Buka Google Maps</a>
                    </span>
                  </div>`
                : ""
            }
          </div>

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

    ["#btnCloseReceipt", "#btnCloseReceipt2"].forEach(selector => {
      $(selector)?.addEventListener("click", () => hide(receiptModal));
    });

    $("#btnPrintReceipt")?.addEventListener("click", () => window.print());

    // ===================================================
    // MANUAL ORDERS
    // ===================================================
    $("#btnNewManualOrder")?.addEventListener("click", () => {
      if (writing || loading) return;

      manualOrderForm?.reset();
      pendingManualOrder = null;
      pendingManualSignature = "";
      show(manualModal);
      $("#manualName")?.focus();
    });

    ["#btnCloseManual", "#btnCancelManual"].forEach(selector => {
      $(selector)?.addEventListener("click", () => {
        if (!writing) hide(manualModal);
      });
    });

    function priceFor(service) {
      const prices = {
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

      return prices[service]
        ? `Rp${prices[service].toLocaleString("id-ID")} / kg`
        : "Sesuai Timbangan";
    }

    function newId() {
      const suffix = globalThis.crypto?.randomUUID
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

      return `YG-${Date.now().toString(36)}-${suffix}`.toUpperCase();
    }

    manualOrderForm?.addEventListener("submit", async event => {
      event.preventDefault();

      if (writing || loading) return;
      if (!manualOrderForm.reportValidity()) return;

      const fields = {
        name: value("#manualName"),
        phone: value("#manualPhone"),
        address: value("#manualAddress"),
        service: value("#manualService"),
        weight: value("#manualWeight") || "-",
        note: value("#manualNote") || "-",
        lat: null,
        lng: null,
        gmapsLink: null,
        status: "Menunggu Penjemputan"
      };

      if (!fields.name || !fields.phone || !fields.address || !fields.service) {
        alert("Nama, nomor WhatsApp, alamat, dan layanan wajib diisi.");
        return;
      }

      fields.priceEstimate = priceFor(fields.service);

      const signature = JSON.stringify(fields);

      if (!pendingManualOrder || signature !== pendingManualSignature) {
        pendingManualOrder = {
          id: newId(),
          createdAt: new Date().toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          }) + " WIB",
          ...fields
        };

        pendingManualSignature = signature;
      }

      const order = pendingManualOrder;
      const controls = Array.from(manualOrderForm.elements);
      const previous = controls.map(control => control.disabled);

      controls.forEach(control => { control.disabled = true; });

      let success;

      try {
        success = await mutate("createOrder", { order });
      } finally {
        controls.forEach((control, index) => {
          control.disabled = previous[index];
        });
      }

      if (!success) return;

      hide(manualModal);
      manualOrderForm.reset();
      pendingManualOrder = null;
      pendingManualSignature = "";

      showReceiptModal(order.id);
    });

    // ===================================================
    // SEARCH / REFRESH / MODAL EVENTS
    // ===================================================
    searchInput?.addEventListener("input", renderDashboard);
    filterStatus?.addEventListener("change", renderDashboard);

    refreshButton?.addEventListener("click", event => {
      event.preventDefault();
      loadOrders(true);
    });

    window.addEventListener("click", event => {
      if (receiptModal && event.target === receiptModal) {
        hide(receiptModal);
      }

      if (manualModal && event.target === manualModal && !writing) {
        hide(manualModal);
      }
    });

    // Pertahankan nama fungsi jika HTML lama memakainya.
    window.updateStatus = updateStatus;
    window.deleteOrder = deleteOrder;
    window.showReceiptModal = showReceiptModal;
    window.editOrder = editOrder;

    // ===================================================
    // STARTUP
    // ===================================================
    async function boot() {
      const savedPin = getSessionPin();

      if (!savedPin) {
        showLogin();
        return;
      }

      try {
        await api("adminLogin", {}, savedPin);
        adminPin = savedPin;
        showAdmin();
        await loadOrders(true);
      } catch (error) {
        showLogin();

        if (loginError) {
          loginError.textContent =
            "Silakan login kembali. " + error.message;
          loginError.style.display = "block";
        }
      }
    }

    boot();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();