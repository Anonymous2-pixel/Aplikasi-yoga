// ===================================================
// YOGA LAUNDRY - CLIENT SCRIPTS & ORDER SYSTEM
// ===================================================
(() => {
  "use strict";

  const STORAGE_KEY = "yoga_orders";
  const WA_PHONE = "6282320565949";

const API_URL =
  "https://script.google.com/macros/s/AKfycby-zjMOSm7k_GkQ9g5ZjbsZb9QC8t7iPyx9ajPD7biuIwn6giuNtWTSoEA_werYeuTq_Q/exec";

  function init() {
    const $ = (selector) => document.querySelector(selector);

    // ===================================================
    // ELEMENTS
    // ===================================================
    const menuButton = $("#menuButton");
    const navLinks = $("#navLinks");

    const orderModal = $("#orderModal");
    const btnCloseOrderModal = $("#btnCloseOrderModal");
    const orderForm = $("#orderForm");
    const custServiceSelect = $("#custService");

    const btnGetLocation = $("#btnGetLocation");
    const btnGetLocationText = $("#btnGetLocationText");
    const locStatusBadge = $("#locStatusBadge");
    const locationPreviewCard = $("#locationPreviewCard");
    const locPreviewAddress = $("#locPreviewAddress");
    const locPreviewCoords = $("#locPreviewCoords");
    const locPreviewMapLink = $("#locPreviewMapLink");
    const locRequiredHint = $("#locRequiredHint");

    const customerReceiptModal = $("#customerReceiptModal");
    const btnCloseCustReceipt = $("#btnCloseCustReceipt");
    const btnCloseCustReceipt2 = $("#btnCloseCustReceipt2");
    const custReceiptPrintArea = $("#custReceiptPrintArea");
    const btnSendWaReceipt = $("#btnSendWaReceipt");
    const btnPrintCustReceipt = $("#btnPrintCustReceipt");

    const trackingModal = $("#trackingModal");
    const btnCloseTracking = $("#btnCloseTracking");
    const btnOpenTrackingNav = $("#btnOpenTrackingNav");
    const btnOpenTrackingHero = $("#btnOpenTrackingHero");
    const trackingInput = $("#trackingInput");
    const btnSubmitTracking = $("#btnSubmitTracking");
    const trackingResult = $("#trackingResult");

    let isSubmitting = false;
    let isTracking = false;
    let locationRequestId = 0;

    let detectedLocation = emptyLocation();

    // Pesanan dipertahankan jika pengiriman gagal.
    // Percobaan ulang memakai nomor resi yang sama.
    let pendingOrder = null;
    let pendingSignature = "";

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

    function inputValue(selector) {
      return $(selector)?.value?.trim() || "";
    }

    function showModal(modal) {
      if (modal) modal.style.display = "flex";
    }

    function hideModal(modal) {
      if (modal) modal.style.display = "none";
    }

    function showLocationHint(message) {
      if (!locRequiredHint) return;

      locRequiredHint.textContent = message;
      locRequiredHint.style.display = "block";
      locRequiredHint.style.color = "#b45309";
    }

    function hideLocationHint() {
      if (!locRequiredHint) return;

      locRequiredHint.style.display = "none";
      locRequiredHint.textContent = "";
    }

    // ===================================================
    // MOBILE NAVIGATION
    // ===================================================
    function closeNavigation() {
      if (!menuButton || !navLinks) return;

      navLinks.classList.remove("is-open");
      menuButton.textContent = "MENU +";
      menuButton.setAttribute("aria-expanded", "false");
    }

    if (menuButton && navLinks) {
      menuButton.addEventListener("click", () => {
        const isOpen = navLinks.classList.toggle("is-open");

        menuButton.textContent = isOpen ? "TUTUP ✕" : "MENU +";
        menuButton.setAttribute("aria-expanded", String(isOpen));
      });

      navLinks.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", closeNavigation);
      });

      document.addEventListener("click", (event) => {
        if (
          navLinks.classList.contains("is-open") &&
          !navLinks.contains(event.target) &&
          !menuButton.contains(event.target)
        ) {
          closeNavigation();
        }
      });
    }

    // ===================================================
    // LOCAL STORAGE: CADANGAN PESANAN TERKONFIRMASI
    // ===================================================
    function getSavedOrders() {
      try {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));

        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.warn("Tidak dapat membaca cadangan lokal:", error);
        return [];
      }
    }

    function cacheOrder(order) {
      try {
        const orders = getSavedOrders();
        const index = orders.findIndex(
          (item) => String(item.id) === String(order.id)
        );

        if (index >= 0) {
          orders[index] = order;
        } else {
          orders.unshift(order);
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
      } catch (error) {
        console.warn("Tidak dapat menyimpan cadangan lokal:", error);
      }
    }

    // ===================================================
    // GOOGLE APPS SCRIPT API
    // ===================================================
    async function requestDatabase(url, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          ...options,
          redirect: "follow",
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
            "Respons database bukan JSON. Periksa URL dan deployment Apps Script."
          );
        }

        if (!data || typeof data !== "object") {
          throw new Error("Format respons database tidak sesuai.");
        }

        if (data.ok === false) {
          throw new Error(
            data.message || "Database menolak permintaan."
          );
        }

        return data;
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error(
            "Waktu menunggu database habis. Status penyimpanan belum dapat dipastikan."
          );
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function saveOrderToStorage(order) {
      const data = await requestDatabase(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          action: "createOrder",
          order
        })
      });

      if (data.ok !== true) {
        throw new Error(
          "Database belum mengonfirmasi bahwa pesanan berhasil disimpan."
        );
      }

      cacheOrder(order);
      return data;
    }

    async function getOrdersFromDatabase() {
      const url = new URL(API_URL);
      url.searchParams.set("action", "getOrders");

      const data = await requestDatabase(url.toString());

      const orders = Array.isArray(data) ? data : data.orders;

      if (!Array.isArray(orders)) {
        throw new Error(
          "Respons database tidak memiliki daftar orders yang valid."
        );
      }

      return orders.filter(
        (order) => order && typeof order === "object" && order.id
      );
    }

    // ===================================================
    // SERVICE CATEGORY TABS FILTER
    // ===================================================
    const serviceTabBtns =
      document.querySelectorAll(".service-tab-btn");

    const serviceCards =
      document.querySelectorAll(".service-card");

    serviceTabBtns.forEach((tab) => {
      tab.addEventListener("click", () => {
        serviceTabBtns.forEach((button) => {
          button.classList.remove("active");
        });

        tab.classList.add("active");

        const filter = tab.getAttribute("data-filter");

        serviceCards.forEach((card) => {
          const category = card.getAttribute("data-category");
          const visible = filter === "all" || category === filter;

          card.style.display = visible ? "flex" : "none";

          if (visible) {
            card.style.animation = "fadeUp 0.35s ease both";
          }
        });
      });
    });

    // ===================================================
    // GPS / GEOLOCATION
    // ===================================================
    function emptyLocation() {
      return {
        lat: null,
        lng: null,
        geoAddress: "",
        gmapsLink: "",
        hasLocation: false
      };
    }

    function syncLocationInputs() {
      const values = {
        custLat: detectedLocation.lat ?? "",
        custLng: detectedLocation.lng ?? "",
        custGmapsLink: detectedLocation.gmapsLink,
        custGeoAddress: detectedLocation.geoAddress
      };

      Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);

        if (element) element.value = value;
      });
    }

    function clearLocationData() {
      detectedLocation = emptyLocation();
      syncLocationInputs();

      if (locationPreviewCard) {
        locationPreviewCard.style.display = "none";
      }

      if (locPreviewAddress) locPreviewAddress.textContent = "";
      if (locPreviewCoords) locPreviewCoords.textContent = "";
      if (locPreviewMapLink) {
        locPreviewMapLink.removeAttribute("href");
      }
    }

    function setLocState(state) {
      if (!btnGetLocation) return;

      btnGetLocation.classList.remove(
        "loc-loading",
        "loc-success",
        "loc-error"
      );

      btnGetLocation.disabled = state === "loading";

      if (locStatusBadge) {
        locStatusBadge.style.display = "none";
      }

      const states = {
        loading: {
          className: "loc-loading",
          text: "Mendeteksi lokasi...",
          badge: "TUNGGU...",
          background: "#fef3c7",
          color: "#b45309"
        },
        success: {
          className: "loc-success",
          text: "Lokasi berhasil terdeteksi — klik untuk memperbarui",
          badge: "TERDETEKSI",
          background: "#dcfce7",
          color: "#15803d"
        },
        error: {
          className: "loc-error",
          text: "Gagal mendeteksi lokasi. Coba lagi atau isi alamat manual.",
          badge: "GAGAL",
          background: "#fee2e2",
          color: "#b91c1c"
        }
      };

      const config = states[state];

      if (!config) {
        if (btnGetLocationText) {
          btnGetLocationText.textContent =
            "Gunakan Lokasi GPS Saya (Otomatis)";
        }

        return;
      }

      btnGetLocation.classList.add(config.className);

      if (btnGetLocationText) {
        btnGetLocationText.textContent = config.text;
      }

      if (locStatusBadge) {
        locStatusBadge.style.display = "inline-block";
        locStatusBadge.textContent = config.badge;
        locStatusBadge.style.background = config.background;
        locStatusBadge.style.color = config.color;
      }
    }

    function resetLocation() {
      // Abaikan callback permintaan lokasi sebelumnya.
      locationRequestId += 1;
      clearLocationData();
      hideLocationHint();
      setLocState("reset");
    }

    async function reverseGeocode(lat, lng) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const url =
        "https://nominatim.openstreetmap.org/reverse" +
        `?lat=${encodeURIComponent(lat)}` +
        `&lon=${encodeURIComponent(lng)}` +
        "&format=json&accept-language=id";

      try {
        const response = await fetch(url, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Alamat lokasi tidak tersedia.");
        }

        const data = await response.json();

        return (
          data.display_name ||
          `Koordinat: ${lat.toFixed(6)}, ${lng.toFixed(6)}`
        );
      } catch {
        return `Koordinat: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      } finally {
        clearTimeout(timer);
      }
    }

    if (btnGetLocation) {
      // Hindari tombol lokasi ikut melakukan submit.
      btnGetLocation.type = "button";

      btnGetLocation.addEventListener("click", () => {
        if (isSubmitting) return;

        if (!("geolocation" in navigator)) {
          setLocState("error");
          showLocationHint(
            "Browser tidak mendukung lokasi. Isi alamat secara manual."
          );
          return;
        }

        const requestId = ++locationRequestId;

        clearLocationData();
        hideLocationHint();
        setLocState("loading");

        navigator.geolocation.getCurrentPosition(
          async (position) => {
            if (requestId !== locationRequestId) return;

            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = position.coords.accuracy;

            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lng) ||
              !Number.isFinite(accuracy) ||
              accuracy > 500
            ) {
              setLocState("error");
              showLocationHint(
                "Akurasi lokasi belum cukup baik. Coba kembali atau isi alamat penjemputan secara manual."
              );
              return;
            }

            const geoAddress = await reverseGeocode(lat, lng);

            if (requestId !== locationRequestId) return;

            const gmapsLink =
              `https://www.google.com/maps?q=${lat},${lng}`;

            detectedLocation = {
              lat,
              lng,
              geoAddress,
              gmapsLink,
              hasLocation: true
            };

            syncLocationInputs();

            if (locPreviewAddress) {
              locPreviewAddress.textContent = geoAddress;
            }

            if (locPreviewCoords) {
              locPreviewCoords.textContent =
                `${lat.toFixed(6)}, ${lng.toFixed(6)}` +
                ` · Perkiraan akurasi ${Math.round(accuracy)} meter`;
            }

            if (locPreviewMapLink) {
              locPreviewMapLink.href = gmapsLink;
              locPreviewMapLink.target = "_blank";
              locPreviewMapLink.rel = "noopener noreferrer";
            }

            if (locationPreviewCard) {
              locationPreviewCard.style.display = "block";
            }

            hideLocationHint();
            setLocState("success");
          },
          (error) => {
            if (requestId !== locationRequestId) return;

            clearLocationData();
            setLocState("error");

            const messages = {
              1: "Izin lokasi ditolak. Aktifkan izin lokasi atau isi alamat secara manual.",
              2: "Lokasi tidak tersedia. Coba lagi atau isi alamat secara manual.",
              3: "Waktu deteksi lokasi habis. Coba lagi atau isi alamat secara manual."
            };

            showLocationHint(
              messages[error.code] || "Gagal mendapatkan lokasi."
            );
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
          }
        );
      });
    }

    // ===================================================
    // ORDER MODAL
    // ===================================================
    document
      .querySelectorAll("[data-open-order='true']")
      .forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();

          if (!orderModal || isSubmitting) return;

          const preService = button.getAttribute("data-service");

          if (preService && custServiceSelect) {
            custServiceSelect.value = preService;
          }

          resetLocation();
          closeNavigation();
          showModal(orderModal);

          $("#custName")?.focus();
        });
      });

    function closeOrderModal() {
      if (isSubmitting) return;

      resetLocation();
      hideModal(orderModal);
    }

    btnCloseOrderModal?.addEventListener(
      "click",
      closeOrderModal
    );

    // ===================================================
    // ORDER HELPERS
    // ===================================================
    function createOrderId() {
      const date = new Date();

      const datePart = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      })
        .format(date)
        .replace(/\//g, "");

      const suffix = globalThis.crypto?.randomUUID
        ? globalThis.crypto
            .randomUUID()
            .replace(/-/g, "")
            .slice(0, 12)
            .toUpperCase()
        : (
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 10)
          ).toUpperCase();

      return `YG-${datePart}-${suffix}`;
    }

    function formatOrderTime() {
      const date = new Date();

      const dateText = date.toLocaleDateString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });

      const timeText = date.toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit"
      });

      return `${dateText}, ${timeText} WIB`;
    }

    function getPriceEstimate(service) {
      const prices = {
        "Cuci Lipat (Reguler)": "Rp5.000 / kg",
        "Cuci Setrika (Reguler)": "Rp7.000 / kg",
        "Setrika Saja (Reguler)": "Rp5.000 / kg",
        "Cuci Lipat (Express 24 Jam)": "Rp7.000 / kg",
        "Cuci Setrika (Express 24 Jam)": "Rp10.000 / kg",
        "Setrika Saja (Express 24 Jam)": "Rp7.000 / kg",
        "Cuci Lipat (Express 6 Jam)": "Rp10.000 / kg",
        "Cuci Setrika (Express 6 Jam)": "Rp14.000 / kg",
        "Setrika Saja (Express 6 Jam)": "Rp10.000 / kg"
      };

      return prices[service] || "Sesuai Timbangan";
    }

    function buildMapLink(order) {
      if (
        order.lat === null ||
        order.lat === undefined ||
        order.lat === "" ||
        order.lng === null ||
        order.lng === undefined ||
        order.lng === ""
      ) {
        return "";
      }

      const lat = Number(order.lat);
      const lng = Number(order.lng);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return "";
      }

      return `https://www.google.com/maps?q=${lat},${lng}`;
    }

    // ===================================================
    // CUSTOMER RECEIPT
    // ===================================================
    function showReceipt(order) {
      const mapLink = buildMapLink(order);

      const locationHtml = mapLink
        ? `
          <a
            href="${escapeHtml(mapLink)}"
            target="_blank"
            rel="noopener noreferrer"
            class="receipt-loc-link"
          >
            Lihat lokasi di Google Maps
          </a>
        `
        : "";

      const rows = [
        ["Pelanggan", `${order.name} (${order.phone})`],
        ["Layanan Dipilih", order.service],
        ["Estimasi Jumlah", order.weight],
        ["Catatan Khusus", order.note],
        ["Estimasi Biaya", order.priceEstimate],
        ["Status Pesanan", order.status]
      ];

      custReceiptPrintArea.innerHTML = `
        <div class="cust-receipt-head">
          <h4>YOGA LAUNDRY</h4>
          <p>WA: 0823-2056-5949</p>
          <p>Buka Setiap Hari: 08.00 - 23.00 WIB</p>
        </div>

        <div class="cust-receipt-meta">
          <span>NO. RESI: <b>#${escapeHtml(order.id)}</b></span>
          <span>${escapeHtml(order.createdAt)}</span>
        </div>

        <div class="cust-receipt-rows">
          ${rows
            .map(
              ([label, value]) => `
                <div class="cust-receipt-row">
                  <span>${escapeHtml(label)}</span>
                  <span>${escapeHtml(value)}</span>
                </div>
              `
            )
            .join("")}

          <div
            class="cust-receipt-row"
            style="flex-direction:column;align-items:flex-start;gap:5px;"
          >
            <span>Lokasi Penjemputan</span>
            <span
              style="font-size:11px;line-height:1.4;text-align:left;max-width:100%;"
            >${escapeHtml(order.address)}</span>
            ${locationHtml}
          </div>
        </div>

        <div class="cust-receipt-foot">
          <p>
            Pesanan berhasil disimpan ke database Yoga Laundry.<br>
            Simpan nomor resi untuk mengecek status pesanan.
          </p>
          <p>
            Klik WhatsApp untuk konfirmasi jadwal penjemputan.
          </p>
        </div>
      `;

      const message = [
        "Halo Yoga Laundry, saya ingin konfirmasi pesanan laundry:",
        "",
        `*NO. RESI:* #${order.id}`,
        `*Nama:* ${order.name}`,
        `*No. WA:* ${order.phone}`,
        `*Alamat Jemput:* ${order.address}`,
        ...(mapLink ? [`*Google Maps:* ${mapLink}`] : []),
        `*Layanan:* ${order.service}`,
        `*Estimasi Jumlah:* ${order.weight}`,
        `*Estimasi Biaya:* ${order.priceEstimate}`,
        `*Catatan:* ${order.note}`,
        "",
        "Mohon konfirmasi penjemputan cucian saya. Terima kasih."
      ].join("\n");

      if (btnSendWaReceipt) {
        btnSendWaReceipt.href =
          `https://wa.me/${WA_PHONE}?text=` +
          encodeURIComponent(message);

        btnSendWaReceipt.target = "_blank";
        btnSendWaReceipt.rel = "noopener noreferrer";
      }

      showModal(customerReceiptModal);
    }

    // ===================================================
    // ORDER SUBMISSION
    // ===================================================
    if (orderForm) {
      orderForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (isSubmitting) return;
        if (!orderForm.reportValidity()) return;

        if (!customerReceiptModal || !custReceiptPrintArea) {
          alert(
            "Elemen struk belum lengkap. Periksa customerReceiptModal dan custReceiptPrintArea pada HTML."
          );
          return;
        }

        const name = inputValue("#custName");
        const phone = inputValue("#custPhone");
        const manualAddress = inputValue("#custAddress");
        const service = inputValue("#custService");
        const weight = inputValue("#custWeight") || "-";
        const note = inputValue("#custNote") || "-";

        if (!name || !phone || !service) {
          alert("Nama, nomor WhatsApp, dan layanan wajib diisi.");
          return;
        }

        // Gunakan state lokasi, bukan hidden input lama.
        const location = { ...detectedLocation };

        if (!location.hasLocation && !manualAddress) {
          showLocationHint(
            "Bagikan lokasi atau isi alamat penjemputan terlebih dahulu."
          );

          ($("#custAddress") || btnGetLocation)?.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });

          return;
        }

        const finalAddress = location.hasLocation
          ? location.geoAddress +
            (manualAddress ? ` (${manualAddress})` : "")
          : manualAddress;

        const orderFields = {
          name,
          phone,
          address: finalAddress,
          lat: location.hasLocation ? location.lat : null,
          lng: location.hasLocation ? location.lng : null,
          gmapsLink: location.hasLocation
            ? location.gmapsLink
            : null,
          service,
          weight,
          note,
          priceEstimate: getPriceEstimate(service),
          status: "Menunggu Penjemputan"
        };

        const signature = JSON.stringify(orderFields);

        if (!pendingOrder || signature !== pendingSignature) {
          pendingOrder = {
            id: createOrderId(),
            createdAt: formatOrderTime(),
            ...orderFields
          };

          pendingSignature = signature;
        }

        const order = pendingOrder;
        const controls = Array.from(orderForm.elements);
        const disabledStates = controls.map(
          (control) => control.disabled
        );

        isSubmitting = true;
        orderForm.setAttribute("aria-busy", "true");

        // Batalkan callback GPS yang masih berjalan.
        locationRequestId += 1;

        controls.forEach((control) => {
          control.disabled = true;
        });

        let saved = false;

        try {
          await saveOrderToStorage(order);
          saved = true;
        } catch (error) {
          console.error("Gagal menyimpan pesanan:", error);

          alert(
            `${error.message}\n\n` +
            "Pesanan belum mendapat konfirmasi berhasil dari database. " +
            "Formulir tidak dihapus.\n\n" +
            `Nomor resi percobaan: ${order.id}\n` +
            "Cek resi terlebih dahulu sebelum mengirim ulang. " +
            "Jika perlu, hubungi admin melalui WhatsApp."
          );
        } finally {
          controls.forEach((control, index) => {
            control.disabled = disabledStates[index];
          });

          isSubmitting = false;
          orderForm.removeAttribute("aria-busy");

          setLocState(
            detectedLocation.hasLocation ? "success" : "reset"
          );
        }

        if (!saved) return;

        pendingOrder = null;
        pendingSignature = "";

        orderForm.reset();
        resetLocation();
        hideModal(orderModal);
        showReceipt(order);
      });
    }

    [btnCloseCustReceipt, btnCloseCustReceipt2].forEach(
      (button) => {
        button?.addEventListener("click", () => {
          hideModal(customerReceiptModal);
        });
      }
    );

    btnPrintCustReceipt?.addEventListener("click", () => {
      window.print();
    });

    // ===================================================
    // TRACKING / CEK STATUS RESI
    // ===================================================
    function openTrackingModal() {
      closeNavigation();
      showModal(trackingModal);

      if (trackingInput) {
        trackingInput.value = "";
        trackingInput.focus();
      }

      if (trackingResult) {
        trackingResult.style.display = "none";
        trackingResult.innerHTML = "";
      }
    }

    [btnOpenTrackingNav, btnOpenTrackingHero].forEach(
      (button) => {
        button?.addEventListener("click", (event) => {
          event.preventDefault();
          openTrackingModal();
        });
      }
    );

    btnCloseTracking?.addEventListener("click", () => {
      hideModal(trackingModal);
    });

    function renderTracking(order) {
      const steps = [
        "Menunggu Penjemputan",
        "Sedang Dijemput",
        "Sedang Dicuci",
        "Sedang Disetrika",
        "Siap Diantar",
        "Selesai"
      ];

      const status = String(order.status || "").trim();
      const currentIndex = steps.indexOf(status);

      // Tracking hanya menampilkan informasi dasar,
      // bukan alamat, nomor telepon, atau koordinat.
      trackingResult.innerHTML = `
        <div style="margin-bottom:14px;">
          <span
            style="font-family:var(--mono);font-size:11px;color:var(--muted);"
          >
            NO. RESI
          </span>

          <h4
            style="margin:2px 0 0;color:var(--navy);font-size:18px;overflow-wrap:anywhere;"
          >
            #${escapeHtml(order.id)}
          </h4>

          <div
            style="font-size:12px;color:#475569;margin-top:4px;"
          >
            Layanan: <b>${escapeHtml(order.service)}</b>
          </div>

          <div
            class="tracking-badge-status"
            style="background:#e0f2fe;color:#0284c7;"
          >
            STATUS: ${escapeHtml(status || "Belum tersedia")}
          </div>
        </div>

        <div class="tracking-timeline">
          ${steps
            .map((step, index) => {
              const active =
                currentIndex >= 0 && index <= currentIndex;

              return `
                <div class="timeline-step ${active ? "active" : ""}">
                  <b>${escapeHtml(step)}</b>
                  ${
                    status === step
                      ? `
                        <span
                          style="color:#2563eb;font-size:11px;display:block;"
                        >
                          (Tahap saat ini)
                        </span>
                      `
                      : ""
                  }
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }

    async function performTracking(event) {
      event?.preventDefault();

      if (isTracking || !trackingInput || !trackingResult) {
        return;
      }

      const query = trackingInput.value
        .trim()
        .toUpperCase()
        .replace(/^#\s*/, "");

      if (!query) {
        alert("Silakan masukkan nomor resi.");
        trackingInput.focus();
        return;
      }

      isTracking = true;

      const wasDisabled = btnSubmitTracking?.disabled;

      if (btnSubmitTracking) {
        btnSubmitTracking.disabled = true;
      }

      trackingResult.style.display = "block";
      trackingResult.textContent =
        "Sedang mencari pesanan di database...";

      try {
        const orders = await getOrdersFromDatabase();

        const order = orders.find((item) => {
          const id = String(item.id).trim().toUpperCase();

          return id === query || id === `YG-${query}`;
        });

        if (!order) {
          trackingResult.innerHTML = `
            <div
              style="text-align:center;padding:20px 10px;color:#ef4444;"
            >
              <b>
                Nomor resi #${escapeHtml(query)} tidak ditemukan.
              </b>
              <p
                style="font-size:12px;color:#64748b;margin-top:6px;"
              >
                Periksa nomor resi pada struk atau hubungi admin
                melalui WhatsApp.
              </p>
            </div>
          `;
          return;
        }

        renderTracking(order);
      } catch (error) {
        console.error("Gagal mengecek resi:", error);

        // Tidak memakai status lokal sebagai status terbaru.
        trackingResult.innerHTML = `
          <div style="padding:16px;color:#b91c1c;">
            <b>Belum bisa mengambil status dari database.</b>
            <p style="font-size:12px;margin-top:6px;">
              ${escapeHtml(error.message)}
            </p>
            <p style="font-size:12px;margin-top:6px;">
              Coba lagi nanti atau hubungi admin melalui WhatsApp.
            </p>
          </div>
        `;
      } finally {
        isTracking = false;

        if (btnSubmitTracking) {
          btnSubmitTracking.disabled = wasDisabled;
        }
      }
    }

    if (btnSubmitTracking) {
      btnSubmitTracking.type = "button";
      btnSubmitTracking.addEventListener(
        "click",
        performTracking
      );
    }

    trackingInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        performTracking(event);
      }
    });

    // ===================================================
    // CLOSE MODALS
    // ===================================================
    window.addEventListener("click", (event) => {
      if (orderModal && event.target === orderModal) {
        closeOrderModal();
      }

      if (
        customerReceiptModal &&
        event.target === customerReceiptModal
      ) {
        hideModal(customerReceiptModal);
      }

      if (trackingModal && event.target === trackingModal) {
        hideModal(trackingModal);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      closeNavigation();
      closeOrderModal();
      hideModal(customerReceiptModal);
      hideModal(trackingModal);
    });
  }

  // Jalankan setelah elemen HTML tersedia.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();