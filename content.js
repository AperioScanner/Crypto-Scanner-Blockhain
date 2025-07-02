console.log("Content script for Crypto Scanner loaded!");

let selectionButton = null;
let mainPopup = null;
let currentSelection = '';

function cleanupUI() {
    console.log("Cleaning up UI...");
    if (selectionButton) {
        selectionButton.remove();
        selectionButton = null;
        console.log("Removed selection button.");
    }
    if (mainPopup) {
        mainPopup.remove();
        mainPopup = null;
        console.log("Removed main popup.");
    }
}

function detectCryptoAddressType(address) {
    console.log("Attempting to detect type for address:", address); 
    const lowerAddress = address.toLowerCase();

    const p2pkhRegex = /^[1][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const p2shRegex = /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const bech32Regex = /^bc1[0-9a-z]{39,87}$/;

    const ethereumRegex = /^0x[a-fA-F0-9]{40}$/;

    const bchCashAddrPrefixedRegex = /^bitcoincash:([qQpP])([0-9a-z]{41})$/;
    const bchCashAddrUnprefixedRegex = /^([qQpP])([0-9a-z]{41})$/; 

    if (bchCashAddrPrefixedRegex.test(lowerAddress)) {
        console.log("Detected as Bitcoin Cash (prefixed).");
        return 'bitcoincash';
    }
    if (bchCashAddrUnprefixedRegex.test(lowerAddress)) {
        console.log("Detected as Bitcoin Cash (unprefixed).");
        return 'bitcoincash';
    }

    if (p2pkhRegex.test(address) || p2shRegex.test(address) || bech32Regex.test(lowerAddress)) {
        console.log("Detected as Bitcoin.");
        return 'bitcoin';
    }

    if (ethereumRegex.test(address)) {
        console.log("Detected as Ethereum.");
        return 'ethereum';
    }

    console.log("No known crypto address format detected for:", address);
    return null;
}

document.addEventListener('mouseup', (event) => {
    if (selectionButton && selectionButton.contains(event.target)) {
        return;
    }

    cleanupUI();

    const selection = window.getSelection();
    currentSelection = selection.toString().trim();
    const addressType = detectCryptoAddressType(currentSelection); 

    if (currentSelection.length > 0 && !selection.isCollapsed && addressType) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        selectionButton = document.createElement('button');
        selectionButton.className = 'custom-selector-button';
        selectionButton.textContent = 'Scan';
        document.body.appendChild(selectionButton);

        const buttonWidth = selectionButton.offsetWidth;
        const buttonHeight = selectionButton.offsetHeight;

        const buttonX = rect.left + window.scrollX + (rect.width / 2) - (buttonWidth / 2);
        const buttonY = rect.bottom + window.scrollY + 10;

        selectionButton.style.left = `${buttonX}px`;
        selectionButton.style.top = `${buttonY}px`;
        selectionButton.style.display = 'block';

        console.log(`Button 'Scan' created and positioned for ${addressType} address:`, currentSelection);

        selectionButton.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();

            console.log(`Button 'Scan' clicked for ${addressType} address. Calling showMainPopup.`);
            showMainPopup(rect, currentSelection, addressType);
        });

    } else {
        console.log("No valid crypto address selected, or selection is empty. No button shown.");
    }
});

document.addEventListener('mousedown', (event) => {
    if ((selectionButton && selectionButton.contains(event.target)) ||
        (mainPopup && mainPopup.contains(event.target))) {
        return;
    }
    cleanupUI();
});

async function showMainPopup(selectionRect, address, type) {
    console.log(`Entering showMainPopup function for ${type} address:`, address);

    if (mainPopup) {
        mainPopup.remove();
        mainPopup = null;
    }

    mainPopup = document.createElement('div');
    mainPopup.className = 'custom-selector-popup';

    let popupTitle = 'Address Detected';
    if (type === 'bitcoin') {
        popupTitle = 'Bitcoin Address Detected';
    } else if (type === 'ethereum') {
        popupTitle = 'Ethereum Address Detected';
    } else if (type === 'bitcoincash') {
        popupTitle = 'Bitcoin Cash Address Detected';
    }

    mainPopup.innerHTML = `
        <div class="custom-selector-popup-header">
            <span class="circle"></span>
            <span class="circle"></span>
            <span class="circle"></span>
            <h3>${popupTitle}</h3>
        </div>
        <div class="custom-selector-popup-content">
            <p>Address: <strong>${address}</strong></p>
            <p class="loading-message">Loading balance...</p>
        </div>
    `;

    document.body.appendChild(mainPopup);
    console.log("Main popup element appended to document.body.");

    const popupWidth = mainPopup.offsetWidth;
    const popupHeight = mainPopup.offsetHeight;
    console.log(`Popup dimensions: Width=${popupWidth}, Height=${popupHeight}`);

    let popupX = selectionRect.left + window.scrollX + (selectionRect.width / 2) - (popupWidth / 2);
    let popupY = selectionRect.top + window.scrollY - popupHeight - 20;

    if (popupX < 10 + window.scrollX) popupX = 10 + window.scrollX;
    if (popupX + popupWidth > window.innerWidth + window.scrollX - 10) popupX = window.innerWidth + window.scrollX - popupWidth - 10;

    if (popupY < 10 + window.scrollY) {
        popupY = selectionRect.bottom + window.scrollY + 10;
        console.log("Popup moved below selection due to screen boundary.");
    }

    mainPopup.style.left = `${popupX}px`;
    mainPopup.style.top = `${popupY}px`;
    console.log(`Popup final position: left=${popupX}px, top=${popupY}px`);

    const popupContentArea = mainPopup.querySelector('.custom-selector-popup-content');

    console.log("Sending message to background script to get balance...");
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_BALANCE', address: address, addressType: type });
        console.log("Received raw response from background script:", response);

        if (response && typeof response === 'object' && 'status' in response && response.status === 'success') {
            if (popupContentArea) {
                let usdDisplay = '';
                if (typeof response.usdValue === 'number') {
                    const formattedUSD = response.usdValue.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    });
                    const usdClass = response.usdValue > 0 ? 'positive' : 'zero';
                    usdDisplay = ` (<span class="balance-usd-value ${usdClass}">USD ${formattedUSD}</span>)`;
                }

                popupContentArea.innerHTML = `
                    <p>Address: <strong>${response.address}</strong></p>
                    <p>Balance: <strong>${response.balance.toFixed(8)} ${response.currencySymbol}${usdDisplay}</strong></p>
                    <p>Transactions: <strong>${response.n_tx}</strong></p>
                `;
                console.log("Popup content updated with success message.");
            }
        } else {
            const errorMessage = (response && response.message)
                ? response.message
                : 'Unexpected or incomplete response from background service.';
            if (popupContentArea) {
                popupContentArea.innerHTML = `
                    <p>Address: <strong>${response ? response.address : address}</strong></p>
                    <p class="error-message">${errorMessage}</p>
                `;
                console.error("Popup content updated with error message from background:", errorMessage);
            }
        }
    } catch (error) {
        console.error("Error communicating with background script or getting response:", error);

        let displayErrorMessage = "Could not retrieve balance. Please try again.";
        if (error && typeof error === 'object' && 'message' in error) {
            displayErrorMessage += ` Error: ${error.message}`;
        } else if (typeof error === 'string') {
            displayErrorMessage += ` Error: ${error}`;
        } else {
            displayErrorMessage += ` Error: Unknown system error.`;
        }

        if (popupContentArea) {
            popupContentArea.innerHTML = `
                <p>Address: <strong>${address}</strong></p>
                <p class="error-message">${displayErrorMessage}</p>
            `;
            console.error("Popup content updated with generic error message from catch block.");
        }
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        console.log("Escape key pressed. Cleaning up UI.");
        cleanupUI();
    }
});
