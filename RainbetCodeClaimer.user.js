text: t, headers: r.headers }));
            })
            .then(({ status, text, headers }) => {
                let data;
                try { data = JSON.parse(text); } catch(e) { data = { error: 'parse_error', raw: text }; }
                window.__rainbetRedeemResult = { status, data, code };
                console.log('📥 Redeem response:', { status, data });
            })
            .catch(e => {
                console.error('🔍 DEBUG: Fetch error:', e);
                window.__rainbetRedeemResult = { error: e.message, code };
                console.error('❌ Redeem request failed:', e);
            });
        })();
        `;
        document.documentElement.appendChild(injectScript);
        
        let pollAttempts = 0;
        const pollInterval = setInterval(() => {
            pollAttempts++;
            if (unsafeWindow.__rainbetRedeemResult && unsafeWindow.__rainbetRedeemResult.code === codeSlug) {
                clearInterval(pollInterval);
                
                const result = unsafeWindow.__rainbetRedeemResult;
                delete unsafeWindow.__rainbetRedeemResult;
                if (!result) return;
                
                const { status, data, error } = result;
                
                if (error) {
                    console.error('❌ Network error:', error);
                    updateStatus(`❌ Network error`);
                    resolveClaim(codeSlug, false, 'Network error: ' + error);
                    return;
                }
                
                console.log('Rainbet API Response:', data);
                
                if (status === 200 && !data.error) {
                    console.log('✅ Code claimed successfully!', data);
                    updateStatus(`✅ Claimed: ${codeSlug}`);
                    
                    GM_notification({
                        title: '✅ Code Claimed!',
                        text: `${codeSlug} redeemed successfully!`,
                        timeout: 5000
                    });
                    
                    resolveClaim(codeSlug, true);
                    
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: `${API_URL}/api/code/claim`,
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': accessToken ? `Bearer ${accessToken}` : ''
                        },
                        data: JSON.stringify({ code: codeSlug, success: true })
                    });
                } else {
                    const errorMsg = parseRainbetError(data.error || 'Unknown error');
                    console.log(`❌ Code rejected:`, errorMsg);
                    
                    if (status === 401) {
                        updateStatus(`❌ Not logged into Rainbet - please refresh and log in`);
                        resolveClaim(codeSlug, false, 'Not logged in to Rainbet');
                        
                        GM_notification({
                            title: '🔒 Login Expired',
                            text: 'Please refresh Rainbet and log back in, then try again',
                            timeout: 10000
                        });
                    } else {
                        updateStatus(`❌ Rejected: ${codeSlug}`);
                        resolveClaim(codeSlug, false, errorMsg);
                        
                        GM_xmlhttpRequest({
                            method: 'POST',
                            url: `${API_URL}/api/code/claim`,
                            headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': accessToken ? `Bearer ${accessToken}` : ''
                            },
                            data: JSON.stringify({ code: codeSlug, success: false, error: errorMsg })
                        });
                    }
                }
            }
            
            if (pollAttempts > 100) {
                clearInterval(pollInterval);
                console.error('❌ Polling timeout');
                updateStatus(`❌ Request timed out`);
                resolveClaim(codeSlug, false, 'Request timed out');
            }
        }, 100);
    }
    
    function parseRainbetError(errorCode) {
        const errorMessages = {
            'er_invalid_redeem_code': 'Invalid or expired code',
            'er_redeem_already_used': 'Code already used',
            'er_redeem_limit_reached': 'Code claim limit reached',
            'er_invalid_authentication_token': 'Not logged in to Rainbet',
            'er_user_not_found': 'User not found',
            'er_insufficient_balance': 'Insufficient balance',
            'er_code_expired': 'Code has expired',
            'er_code_not_active': 'Code is not active',
        };
        
        return errorMessages[errorCode] || errorCode;
    }
    
    function updateCodesList() {
        const container = document.getElementById('rainbet-codes-list');
        if (!container) return;

        if (codes.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:60px 20px; color:#666;">
                    <h3 style="margin:0 0 10px;">No Codes Yet</h3>
                    <p>Codes from Telegram will appear here</p>
                </div>
            `;
            return;
        }

        container.innerHTML = codes.map(code => {
            let statusClass = 'pending';
            let statusText = '⏳ Pending';
            
            if (code.claimed) {
                statusClass = 'claimed';
                statusText = '✅ Claimed';
            } else if (code.rejectionReason) {
                statusClass = 'rejected';
                statusText = '❌ Rejected';
            }

            return `
                <div class="code-item ${statusClass}">
                    <div class="code-header">
                        <span class="code-value">${code.code}</span>
                        <span class="code-badge ${statusClass}">${statusText}</span>
                    </div>
                    <div class="code-info-grid">
                        <div>
                            <div class="code-info-label">Value</div>
                            <div class="code-info-value">${code.value || '-'}</div>
                        </div>
                        <div>
                            <div class="code-info-label">Source</div>
                            <div class="code-info-value">${code.source || 'API'}</div>
                        </div>
                        <div>
                            <div class="code-info-label">Time</div>
                            <div class="code-info-value">${new Date(code.timestamp).toLocaleTimeString()}</div>
                        </div>
                    </div>
                    ${code.rejectionReason ? `<div class="code-rejection-reason">❌ ${code.rejectionReason}</div>` : ''}
                </div>
            `;
        }).join('');

        document.getElementById('rainbet-total-codes').textContent = codes.length;
        document.getElementById('rainbet-claimed-codes').textContent = codes.filter(c => c.claimed).length;
        document.getElementById('rainbet-rejected-codes').textContent = codes.filter(c => c.rejectionReason).length;
    }

    function fetchAndProcessCodes() {
        if (!isAuthenticated) return;
        
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${API_URL}/api/codes`,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': accessToken ? `Bearer ${accessToken}` : ''
            },
            timeout: 5000,
            onload: function(response) {
                try {
                    const newCodes = JSON.parse(response.responseText);
                    
                    if (!Array.isArray(newCodes) || newCodes.length === 0) return;
                    
                    const latestCode = newCodes[0];
                    
                    if (clearTimestamp > 0) {
                        const codeTimestamp = new Date(latestCode.timestamp).getTime();
                        if (codeTimestamp < clearTimestamp) {
                            return;
                        }
                    }
                    
                    if (!codes.find(c => c.code === latestCode.code) && !processedCodes[latestCode.code]) {
                        console.log(`⚡ NEW CODE: ${latestCode.code}`);
                        
                        codes.unshift(latestCode);
                        saveCodesLocal();
                        updateCodesList();
                        
                        GM_notification({
                            title: '⚡ NEW CODE!',
                            text: latestCode.code,
                            timeout: 2000
                        });
                        
                        redeemCodeOnRainbet(latestCode.code);
                    }
                } catch (e) {
                    console.error('Failed to parse codes:', e);
                }
            },
            onerror: function(error) {
                console.warn('API Error - server may be starting up');
            }
        });
    }
    
    function init() {
        setupPublicIdListener();
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(startApp, 1000));
        } else {
            setTimeout(startApp, 1000);
        }
    }
    
    function startApp() {
        console.log('🚀 Rainbet Code Claimer v1.1 started');
        
        injectUI();
        injectPublicIdReader();
        
        setInterval(pollForPublicId, ID_CHECK_INTERVAL);
        setInterval(fetchAndProcessCodes, TIMEOUTS.POLL_CODES);
    }
    
    init();
})();
