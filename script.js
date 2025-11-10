import { createWalletClient, custom } from "https://esm.sh/viem@2";
import { mainnet, polygon, arbitrum } from "https://esm.sh/viem/chains";

/* === DOM references === */
const connectButton = document.getElementById("connectWallet");
const walletAddressDisplay = document.getElementById("walletAddress");
const tokenTableBody = document.querySelector("#tokenTable tbody");
const totalValueDisplay = document.getElementById("totalValue");
const ethPriceDisplay = document.getElementById("ethPriceDisplay");
const ensNameDisplay = document.getElementById("ensName");
const gasPriceDisplay = document.getElementById("gasPrice");
const tokenSearchInput = document.getElementById("searchToken") || document.getElementById("tokenSearch");

let shareBtn = document.getElementById("shareBtn");
let exportBtn = document.getElementById("exportCsv");

/* API keys */
const COVALENT_API_KEY = "cqt_rQWm9fdx3v3DJ6KF3fQ9wtym877K";

/* State */
let walletAddress = null;
let viewedAddress = null;
let currentChain = "eth-mainnet";
let refreshInterval = null;
let lastTokens = [];
let portfolioHistory = JSON.parse(localStorage.getItem("portfolioHistory") || "[]");

/* ---------------------------
   Utility: read URL params
   --------------------------- */
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    address: params.get("address"),
    chain: params.get("chain"),
  };
}

/* ---------------------------
   Small DOM helpers
   --------------------------- */
function shortAddress(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function saveLastViewed(address, chain) {
  if (!address) return;
  localStorage.setItem("lastAddress", address);
  localStorage.setItem("lastChain", chain);
}

/* ---------------------------
   ETH price (CoinGecko)
   --------------------------- */
async function getEthPriceUSD() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,polygon,arbitrum&vs_currencies=usd");
    const data = await res.json();
    const ethPrice = data?.ethereum?.usd ?? null;
    if (ethPriceDisplay && ethPrice != null) ethPriceDisplay.textContent = `ETH Price: $${Number(ethPrice).toFixed(2)}`;
    return ethPrice;
  } catch (e) {
    console.error("Failed to fetch ETH price:", e);
    if (ethPriceDisplay) ethPriceDisplay.textContent = `ETH Price: —`;
    return null;
  }
}

/* ---------------------------
   ENS + Gas
   --------------------------- */
async function getENSName(address) {
  if (!ensNameDisplay) return;
  try {
    const res = await fetch(`https://api.ensideas.com/ens/resolve/${address}`);
    const data = await res.json();
    ensNameDisplay.textContent = data?.name ? `ENS: ${data.name}` : "ENS: —";
  } catch {
    ensNameDisplay.textContent = "ENS: —";
  }
}

async function getGasPrice() {
  if (!gasPriceDisplay) return;
  try {
    const res = await fetch("https://api.etherscan.io/api?module=gastracker&action=gasoracle");
    const data = await res.json();
    const gas = data?.result?.ProposeGasPrice;
    gasPriceDisplay.textContent = gas ? `Gas Price: ${gas} Gwei` : "Gas Price: —";
  } catch {
    gasPriceDisplay.textContent = "Gas Price: —";
  }
}

/* refresh gas every 15s */
setInterval(getGasPrice, 15000);
getGasPrice();

/* ---------------------------
   Chain selector (use existing HTML select)
   --------------------------- */
const chainSelector = document.getElementById("chainSelector");
if (chainSelector) {
  chainSelector.addEventListener("change", async (e) => {
    currentChain = e.target.value;
    // save chain for next load
    localStorage.setItem("lastChain", currentChain);
    // reload portfolio for viewed address (if any)
    if (viewedAddress) await loadPortfolio(viewedAddress);
  });
} else {
  console.warn("chainSelector element not found in HTML.");
}

/* ---------------------------
   Connect wallet (MetaMask)
   --------------------------- */
connectButton.addEventListener("click", async () => {
  try {
    if (!window.ethereum) {
      return alert("Please install MetaMask!");
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    walletAddress = accounts[0];
    viewedAddress = walletAddress;
    walletAddressDisplay.textContent = `Connected: ${shortAddress(walletAddress)}`;
    connectButton.textContent = "Connected ✅";

    // After connecting — update ENS and load portfolio, and save
    await getENSName(walletAddress);
    await loadPortfolio(walletAddress);
    saveLastViewed(walletAddress, currentChain);
  } catch (err) {
    console.error("Wallet connection error:", err);
  }
});

/* ---------------------------
   Share / CSV UI buttons creation (if not present in HTML)
   --------------------------- */
function ensureUtilityButtons() {
  // create share button
  if (!shareBtn) {
    shareBtn = document.createElement("button");
    shareBtn.id = "shareBtn";
    shareBtn.textContent = "Share Link";
    shareBtn.style.marginLeft = "8px";
    // insert next to connectButton
    connectButton.insertAdjacentElement("afterend", shareBtn);
  }
  // create export CSV
  if (!exportBtn) {
    exportBtn = document.createElement("button");
    exportBtn.id = "exportCsv";
    exportBtn.textContent = "Export CSV";
    exportBtn.style.marginLeft = "8px";
    shareBtn.insertAdjacentElement("afterend", exportBtn);
  }

  shareBtn.addEventListener("click", () => {
    if (!viewedAddress) return alert("No address to share.");
    const url = new URL(window.location.href);
    url.searchParams.set("address", viewedAddress);
    url.searchParams.set("chain", currentChain);
    navigator.clipboard.writeText(url.toString()).then(() => {
      shareBtn.textContent = "Copied!";
      setTimeout(() => (shareBtn.textContent = "Share Link"), 1500);
    });
  });

  exportBtn.addEventListener("click", () => {
    if (!lastTokens || lastTokens.length === 0) return alert("No tokens to export.");
    const rows = [
      ["Token", "Balance", "PriceUSD", "ValueUSD", "ContractAddress", "Chain"],
      ...lastTokens.map((t) => [
        t.contract_ticker_symbol,
        (t.balance / Math.pow(10, t.contract_decimals)).toString(),
        (t.quote_rate || 0).toString(),
        ((t.balance / Math.pow(10, t.contract_decimals)) * (t.quote_rate || 0)).toString(),
        t.contract_address || "",
        currentChain,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chainport_${viewedAddress?.slice(0, 6) || "snapshot"}_${currentChain}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}
ensureUtilityButtons();

/* ---------------------------
   Performance history (localStorage)
   --------------------------- */
function addToHistory(totalValue) {
  const nowISO = new Date().toISOString();
  portfolioHistory.push({ time: nowISO, value: totalValue });
  // keep last 7 days worth of points but limit size to avoid bloat (e.g., 1000 points)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  portfolioHistory = portfolioHistory.filter((p) => p.time >= cutoff);
  if (portfolioHistory.length > 1000) portfolioHistory.shift();
  localStorage.setItem("portfolioHistory", JSON.stringify(portfolioHistory));
}

function percentChangeSince(hours) {
  if (!portfolioHistory || portfolioHistory.length === 0) return null;
  const now = Date.now();
  const cutoff = now - hours * 60 * 60 * 1000;
  // find earliest point >= cutoff
  const earlier = portfolioHistory.find((p) => new Date(p.time).getTime() >= cutoff);
  if (!earlier) return null;
  const latest = portfolioHistory[portfolioHistory.length - 1].value;
  const earlierValue = earlier.value;
  if (!earlierValue || earlierValue === 0) return null;
  return ((latest - earlierValue) / earlierValue) * 100;
}

/* display performance summary in header/status bar */
function updatePerformanceSummary() {
  const p24 = percentChangeSince(24);
  const p7d = percentChangeSince(24 * 7);
  // create or update a small summary element
  let perfEl = document.getElementById("perfSummary");
  if (!perfEl) {
    perfEl = document.createElement("p");
    perfEl.id = "perfSummary";
    perfEl.style.color = "#ffd36a";
    perfEl.style.marginLeft = "12px";
    const statusBar = document.querySelector(".wallet-info") || document.querySelector(".status-bar") || document.body;
    statusBar.insertAdjacentElement("beforeend", perfEl);
  }
  perfEl.textContent = `24h: ${p24 === null ? "N/A" : p24.toFixed(2) + "%"} • 7d: ${p7d === null ? "N/A" : p7d.toFixed(2) + "%"}`;
}

/* ---------------------------
   Sparkline helper (existing)
   --------------------------- */
async function getSparkline(symbol) {
  const idMap = {
    ETH: "ethereum",
    MATIC: "matic-network",
    ARB: "arbitrum",
    USDC: "usd-coin",
    USDT: "tether",
    DAI: "dai",
  };
  const id = idMap[symbol.toUpperCase()];
  if (!id) return null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7&interval=daily`);
    const data = await res.json();
    return data?.prices?.map((p) => p[1]) || null;
  } catch (e) {
    return null;
  }
}

function renderSparkline(canvasId, prices) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !prices || prices.length === 0) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const scaleX = canvas.width / (prices.length - 1 || 1);
  const scaleY = (max - min) === 0 ? 1 : canvas.height / (max - min);

  ctx.beginPath();
  ctx.strokeStyle = "#FFD700";
  ctx.lineWidth = 1;
  prices.forEach((p, i) => {
    const x = i * scaleX;
    const y = canvas.height - (p - min) * scaleY;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ---------------------------
   Core: loadPortfolio (Covalent)
   --------------------------- */
async function loadPortfolio(address) {
  if (!address) return;
  try {
    tokenTableBody.innerHTML = "<tr><td colspan='5' style='text-align:center'>Loading...</td></tr>";
    viewedAddress = address;

    // update UI
    walletAddressDisplay.textContent = `Viewing: ${shortAddress(address)}`;

    // fetch price + covalent
    const ethPrice = await getEthPriceUSD();
    const selectedChain = (chainSelector && chainSelector.value) || currentChain;

    const url = `https://api.covalenthq.com/v1/${selectedChain}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    const items = data?.data?.items || [];
    // filter out zero balances and system placeholders
    const tokens = items.filter((t) => Number(t.balance) > 0 && t.contract_decimals > 0);

    tokenTableBody.innerHTML = "";
    lastTokens = tokens;

    let totalUsd = 0;
    for (const token of tokens) {
      const balance = Number(token.balance) / Math.pow(10, token.contract_decimals);
      const price = token.contract_ticker_symbol === "ETH" ? ethPrice : (token.quote_rate || 0);
      const value = balance * price;
      totalUsd += value;

      const logo = token.logo_url || "";

      // create row with sparkline canvas placeholder
      const row = document.createElement("tr");
      row.innerHTML = `
        <td style="display:flex;align-items:center;gap:8px">
          ${logo ? `<img src="${logo}" class="token-icon" alt="${token.contract_ticker_symbol}" onerror="this.style.display='none'">` : ''}
          <span class="token-name">${token.contract_ticker_symbol}</span>
        </td>
        <td>${balance.toFixed(4)}</td>
        <td>$${Number(price).toFixed(2)}</td>
        <td>$${Number(value).toFixed(2)}</td>
        <td><canvas id="spark-${token.contract_ticker_symbol}" width="80" height="26"></canvas></td>
      `;
      tokenTableBody.appendChild(row);

      // fetch sparkline and render (best-effort)
      getSparkline(token.contract_ticker_symbol).then((prices) => {
        if (prices) renderSparkline(`spark-${token.contract_ticker_symbol}`, prices);
      });
    }

    totalValueDisplay.textContent = `Total Value: $${totalUsd.toFixed(2)}`;

    // history + performance
    addToHistory(totalUsd);
    updatePerformanceSummary();

    // Save last viewed for read-only loading later
    saveLastViewed(address, selectedChain);
  } catch (err) {
    console.error("loadPortfolio error:", err);
    tokenTableBody.innerHTML = "<tr><td colspan='5' style='text-align:center;color:#ffb86c'>Failed to load data</td></tr>";
  }
}

/* ---------------------------
   Auto refresh (30s)
   --------------------------- */
function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    if (viewedAddress) loadPortfolio(viewedAddress);
  }, 30000);
}
startAutoRefresh();

/* ---------------------------
   Token search (filter)
   --------------------------- */
if (tokenSearchInput) {
  tokenSearchInput.addEventListener("input", () => {
    const term = tokenSearchInput.value.toLowerCase();
    tokenTableBody.querySelectorAll("tr").forEach((row) => {
      const name = (row.querySelector(".token-name")?.textContent || "").toLowerCase();
      row.style.display = name.includes(term) ? "" : "none";
    });
  });
}

/* ---------------------------
   Load from URL or localStorage on start
   --------------------------- */
(async function boot() {
  // If URL has address param, show that first (read-only)
  const params = getUrlParams();
  if (params.chain) {
    currentChain = params.chain;
    if (chainSelector) chainSelector.value = currentChain;
  } else {
    // set chainSelector from localStorage if present
    const savedChain = localStorage.getItem("lastChain");
    if (savedChain && chainSelector) {
      currentChain = savedChain;
      chainSelector.value = savedChain;
    }
  }

  if (params.address) {
    // read-only load
    await loadPortfolio(params.address);
  } else {
    // try load last viewed from localStorage (read-only)
    const last = localStorage.getItem("lastAddress");
    if (last) {
      await loadPortfolio(last);
    }
  }
})();

/* ---------------------------
   Portfolio Performance Chart
   --------------------------- */
let perfChart = null;

function renderPerformanceChart() {
  const canvas = document.getElementById("performanceChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dataPoints = portfolioHistory.map((p) => ({
    x: new Date(p.time),
    y: p.value,
  }));

  if (perfChart) {
    // update existing chart
    perfChart.data.datasets[0].data = dataPoints;
    perfChart.update();
    return;
  }

  perfChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Portfolio Value (USD)",
          data: dataPoints,
          borderColor: "#ffd36a",
          backgroundColor: "rgba(255,211,106,0.2)",
          fill: true,
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "time",
          time: { unit: "hour", tooltipFormat: "MMM d, h:mm a" },
          ticks: { color: "#ccc" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
        y: {
          ticks: { color: "#ccc", callback: (v) => "$" + v.toFixed(0) },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
    },
  });
}

/* hook chart rendering into history updates */
const oldAddToHistory = addToHistory;
addToHistory = function(totalValue) {
  oldAddToHistory(totalValue);
  renderPerformanceChart();
};