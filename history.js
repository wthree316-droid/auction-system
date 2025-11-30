import { db, auth } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";


// ฟังก์ชันหลักสำหรับเริ่มต้นหน้าประวัติ
export async function initHistoryPage() {
    // ตรวจสอบการ Login
    onAuthStateChanged(auth, (user) => {
        if (user) {
            loadHistory();
        } else {
            signInAnonymously(auth).catch(console.error);
        }
    });
}

// ฟังก์ชันโหลดและแสดงข้อมูลประวัติ
async function loadHistory() {
    const soldListContainer = document.getElementById('soldList');
    const expiredListContainer = document.getElementById('expiredList');
    const loadingSection = document.getElementById('loadingSection');
    const historyContent = document.getElementById('historyContent');

    if (!soldListContainer || !expiredListContainer) return;

    const now = new Date().getTime();

    try {
        // ดึงข้อมูลสินค้าทั้งหมด เรียงตามเวลาล่าสุด
        const q = query(collection(db, "auctions"), orderBy("created_at", "desc"));
        const snapshot = await getDocs(q);
        
        soldListContainer.innerHTML = "";
        expiredListContainer.innerHTML = "";
        
        let soldCount = 0;
        let expiredCount = 0;
        let revenue = 0;
        let promises = []; // เก็บ Promise สำหรับการดึงชื่อผู้ชนะ

        snapshot.forEach(docSnap => {
            const item = docSnap.data();
            const isSold = item.status === 'sold';
            const isExpired = item.end_time_ms && now > item.end_time_ms;

            if (isSold || isExpired) {
                count++;
                if (isSold) revenue += (item.current_price || 0);
                
                // สร้าง Element การ์ดสินค้า
                const col = document.createElement('div');
                col.className = "col-12 col-md-6 col-lg-4 col-xl-3";
                
                let statusBadge = isSold ? 
                    `<span class="sold-badge">SOLD <i class="bi bi-check-lg"></i></span>` : 
                    `<span class="expired-badge">EXPIRED</span>`;
                
                // 🔥 เพิ่ม Overlay ข้อความทับรูป
                let overlayText = isSold ? "ขายแล้ว" : "ปิดประมูล";
                let overlayClass = isSold ? "sold-overlay-text" : "expired-overlay-text";
                
                let priceColor = isSold ? "text-success" : "text-secondary";
                let dateStr = item.end_time_ms ? new Date(item.end_time_ms).toLocaleDateString('th-TH') : "-";

                col.innerHTML = `
                    <div class="card h-100 card-history position-relative" style="cursor: pointer;">
                        ${statusBadge}
                        
                        <div class="position-relative overflow-hidden">
                            <img src="${item.image_url}" class="card-img-top product-img-list" onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
                            <!-- 🔥 Overlay ทับรูป -->
                            <div class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style="background: rgba(0,0,0,0.5);">
                                <span class="${overlayClass}">${overlayText}</span>
                            </div>
                        </div>

                        <div class="card-body p-3">
                            <h6 class="card-title text-truncate text-white mb-1">${item.title}</h6>
                            <p class="card-text fw-bold ${priceColor} mb-2">จบที่: ฿${item.current_price.toLocaleString()}</p>
                            
                            <div class="d-flex justify-content-between align-items-end border-top border-secondary pt-2 mt-2">
                                <div>
                                    <small class="text-secondary d-block" style="font-size: 0.7rem;">ผู้ชนะ:</small>
                                    <div id="winner-${docSnap.id}" class="small text-secondary">
                                        ${isSold ? '<span class="spinner-border spinner-border-sm" style="width:0.7rem; height:0.7rem;"></span> หาผู้ชนะ...' : (item.last_bidder_uid ? '<span class="spinner-border spinner-border-sm" style="width:0.7rem; height:0.7rem;"></span> หาผู้สูงสุด...' : '-')}
                                    </div>
                                </div>
                                <small class="text-secondary" style="font-size: 0.7rem;">${dateStr}</small>
                            </div>
                        </div>
                    </div>
                `;
                
                // ... (ส่วน event click และดึงชื่อผู้ชนะ เหมือนเดิม) ...
                col.querySelector('.card').onclick = () => openHistoryDetail(item, docSnap.id);
                
                listContainer.appendChild(col);

                if (isSold && item.buyer_uid) {
                    promises.push(
                        getDoc(doc(db, "users", item.buyer_uid)).then(userSnap => {
                            const winnerName = userSnap.exists() ? userSnap.data().displayName : "Unknown";
                            const winnerEl = document.getElementById(`winner-${docSnap.id}`);
                            if(winnerEl) {
                                winnerEl.innerHTML = `<span class="winner-badge"><i class="bi bi-trophy-fill"></i> ${winnerName}</span>`;
                                item.winner_name = winnerName; 
                            }
                        })
                    );
                } else if (isExpired && item.last_bidder_uid) {
                     promises.push(
                        getDoc(doc(db, "users", item.last_bidder_uid)).then(userSnap => {
                            const winnerName = userSnap.exists() ? userSnap.data().displayName : "Unknown";
                            const winnerEl = document.getElementById(`winner-${docSnap.id}`);
                            if(winnerEl) {
                                winnerEl.innerHTML = `<span class="text-white small">${winnerName} (สูงสุด)</span>`;
                                item.winner_name = winnerName; 
                            }
                        })
                    );
                }
            }
        });

        // ... (ส่วนอัปเดตยอด เหมือนเดิม) ...
        const totalItemsEl = document.getElementById('totalItems');
        const totalRevenueEl = document.getElementById('totalRevenue');
        
        if(totalItemsEl) totalItemsEl.innerText = count;
        if(totalRevenueEl) totalRevenueEl.innerText = `฿${revenue.toLocaleString()}`;

        if (count === 0) {
            listContainer.innerHTML = `
                <div class="col-12 text-center text-secondary mt-5 opacity-50">
                    <i class="bi bi-inbox-fill display-1"></i>
                    <p class="mt-3">ยังไม่มีประวัติสินค้าที่จบประมูล</p>
                </div>`;
        }

        await Promise.all(promises);

    } catch (error) {
        console.error("Load History Error:", error);
        listContainer.innerHTML = `<p class="text-center text-danger">โหลดข้อมูลไม่สำเร็จ: ${error.message}</p>`;
    }
}

// ฟังก์ชันเปิด Modal รายละเอียดประวัติ
function openHistoryDetail(item, id) {
    const detailModal = new bootstrap.Modal(document.getElementById('historyDetailModal'));
    
    document.getElementById('detailTitle').innerText = item.title;
    document.getElementById('detailImage').src = item.image_url;
    document.getElementById('detailPrice').innerText = `฿${item.current_price.toLocaleString()}`;
    document.getElementById('detailDate').innerText = new Date(item.end_time_ms).toLocaleString('th-TH');
    document.getElementById('detailDesc').innerText = item.description || "ไม่มีรายละเอียด";
    
    // 🔥 เพิ่ม Overlay ใน Modal ด้วย
    const overlayContainer = document.getElementById('detailImageOverlay');
    if (item.status === 'sold') {
        overlayContainer.innerHTML = '<div class="sold-text-modal">ขายแล้ว</div>';
    } else {
        overlayContainer.innerHTML = '<div class="expired-text-modal">ปิดประมูล</div>';
    }

    const winnerEl = document.getElementById('detailWinner');
    const statusBadge = document.getElementById('detailStatusBadge');
    
    let winnerName = item.winner_name || "Unknown"; 

    if (item.status === 'sold') {
        statusBadge.innerText = "SOLD";
        statusBadge.className = "badge bg-success mb-2";
        winnerEl.innerText = winnerName;
        winnerEl.className = "text-warning fw-bold";
    } else {
        statusBadge.innerText = "EXPIRED";
        statusBadge.className = "badge bg-secondary mb-2";
        if(item.last_bidder_uid) {
            winnerEl.innerText = `${winnerName} (สูงสุด)`;
            winnerEl.className = "text-white";
        } else {
            winnerEl.innerText = "-";
            winnerEl.className = "text-secondary";
        }
    }

    detailModal.show();
}

// ทำให้ฟังก์ชัน openHistoryDetail เรียกใช้ได้จาก HTML
window.openHistoryDetail = openHistoryDetail;
