import { createWalletClient, custom } from "https://esm.sh/viem@2";
import { mainnet, polygon, arbitrum } from "https://esm.sh/viem/chains";

const connectButton = document.getElementById("connectWallet");
const walletAddressDisplay = document.getElementById("walletAddress");
const tokenTableBody = document.querySelector("#tokenTable tbody");
const totalValueDisplay = document.getElementById("totalValue");
const ethPriceDisplay = document.getElementById("ethPriceDisplay");

const COVALENT_API_KEY = "cqt_rQWm9fdx3v3DJ6KF3fQ9wtym877K";

let walletAddress = null;
let currentChain = "eth-mainnet"; // default

// ===============================
// 🪙 FETCH REAL-TIME ETH PRICE
// ===============================
async function getEthPriceUSD() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,polygon,arbitrum&vs_currencies=usd"
    );
    const data = await res.json();
    const ethPrice = data.ethereum.usd;

    if (ethPriceDisplay) ethPriceDisplay.textContent = `ETH Price: $${ethPrice}`;
    return ethPrice;
  } catch (e) {
    console.error("❌ Failed to fetch ETH price:", e);
    return null;
  }
}

// 🔁 Auto-refresh ETH price every 15 seconds
setInterval(getEthPriceUSD, 15000);
getEthPriceUSD();

// ===============================
// 🌐 CHAIN SELECTOR
// ===============================
const chainSelector = document.createElement("select");
chainSelector.innerHTML = `
  <option value="eth-mainnet">Ethereum</option>
  <option value="matic-mainnet">Polygon</option>
  <option value="arbitrum-mainnet">Arbitrum</option>
`;
chainSelector.style.marginLeft = "10px";
connectButton.insertAdjacentElement("afterend", chainSelector);

chainSelector.addEventListener("change", (e) => {
  currentChain = e.target.value;
  if (walletAddress) loadPortfolio(walletAddress);
});

// ===============================
// 🦊 CONNECT WALLET
// ===============================
connectButton.addEventListener("click", async () => {
  try {
    if (!window.ethereum) {
      alert("Please install MetaMask!");
      return;
    }

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    walletAddress = accounts[0];
    walletAddressDisplay.textContent = `Connected: ${walletAddress}`;
    connectButton.textContent = "Connected ✅";

    await loadPortfolio(walletAddress);
  } catch (error) {
    console.error(error);
  }
});

// ===============================
// 📊 LOAD PORTFOLIO
// ===============================
async function loadPortfolio(address) {
  try {
    tokenTableBody.innerHTML = "<tr><td colspan='4'>Loading...</td></tr>";

    const ethPrice = await getEthPriceUSD();
    const response = await fetch(
      `https://api.covalenthq.com/v1/${currentChain}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}`
    );
    const data = await response.json();

    const tokens = data.data.items.filter(
      (t) => t.balance > 0 && t.contract_decimals > 0
    );

    tokenTableBody.innerHTML = "";
    let totalUsd = 0;

    tokens.forEach((token) => {
      const balance = token.balance / Math.pow(10, token.contract_decimals);
      const price =
        token.contract_ticker_symbol === "ETH"
          ? ethPrice
          : token.quote_rate || 0;
      const value = balance * price;
      totalUsd += value;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${token.contract_ticker_symbol}</td>
        <td>${balance.toFixed(4)}</td>
        <td>$${price.toFixed(2)}</td>
        <td>$${value.toFixed(2)}</td>
      `;
      tokenTableBody.appendChild(row);
    });

    totalValueDisplay.textContent = `Total Value: $${totalUsd.toFixed(2)}`;
    renderPortfolioChart(tokens);
  } catch (err) {
    console.error("Error loading portfolio:", err);
    tokenTableBody.innerHTML = "<tr><td colspan='4'>Failed to load data</td></tr>";
  }
}

let portfolioChart = null;

function renderPortfolioChart(tokens) {
  const ctx = document.getElementById("portfolioChart").getContext("2d");

  const labels = tokens.map((t) => t.contract_ticker_symbol);
  const values = tokens.map((t) => {
    const balance = t.balance / Math.pow(10, t.contract_decimals);
    const price = t.quote_rate || 0;
    return balance * price;
  });

  if (portfolioChart) portfolioChart.destroy(); // reset before re-render

  portfolioChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: [
            "#00b8b8",
            "#00e0e0",
            "#007a7a",
            "#66ffff",
            "#99ffcc",
            "#004d4d",
          ],
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { color: "#cfd8dc" } },
      },
    },
  });
}
