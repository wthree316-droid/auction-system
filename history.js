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

            // เงื่อนไขการแสดงผล:
            // 1. ขายแล้ว (Sold) -> แสดงแน่นอน
            // 2. หมดเวลา (Expired) -> ต้องมีคนเคยประมูล (last_bidder_uid) ถึงจะแสดง
            //    (ถ้าหมดเวลาเฉยๆ โดยไม่มีใครสนใจ ไม่ต้องเอามาโชว์ให้รก)
            
            let shouldShow = false;
            let targetContainer = null;

            if (isSold) {
                shouldShow = true;
                targetContainer = soldListContainer;
                soldCount++;
                revenue += (item.current_price || 0);
            } else if (isExpired && item.last_bidder_uid) { // 🔥 เช็คว่ามีคนประมูลไหม
                shouldShow = true;
                targetContainer = expiredListContainer;
                expiredCount++;
            }

            if (shouldShow && targetContainer) {
                
                // สร้าง Element การ์ดสินค้า
                const col = document.createElement('div');
                col.className = "col-12 col-md-6 col-lg-4 col-xl-3";
                
                let statusBadge = isSold ? 
                    `<span class="badge bg-success position-absolute top-0 end-0 m-2">SOLD</span>` : 
                    `<span class="badge bg-secondary position-absolute top-0 end-0 m-2">CLOSED</span>`;
                
                let priceColor = isSold ? "text-success" : "text-secondary";
                let dateStr = item.end_time_ms ? new Date(item.end_time_ms).toLocaleDateString('th-TH') : "-";

                col.innerHTML = `
                    <div class="card h-100 card-history position-relative" style="cursor: pointer;">
                        ${statusBadge}
                        <img src="${item.image_url}" class="card-img-top product-img-list" onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
                        <div class="card-body p-3">
                            <h6 class="card-title text-truncate text-white mb-1">${item.title}</h6>
                            <p class="card-text fw-bold ${priceColor} mb-2">จบที่: ฿${item.current_price.toLocaleString()}</p>
                            
                            <div class="d-flex justify-content-between align-items-end">
                                <div id="winner-${docSnap.id}" class="small text-secondary">
                                    ${isSold ? '<span class="spinner-border spinner-border-sm" style="width:0.7rem; height:0.7rem;"></span> หาผู้ชนะ...' : (item.last_bidder_uid ? '<span class="spinner-border spinner-border-sm" style="width:0.7rem; height:0.7rem;"></span> หาผู้สูงสุด...' : 'ไม่มีผู้ประมูล')}
                                </div>
                                <small class="text-secondary" style="font-size: 0.7rem;">${dateStr}</small>
                            </div>
                        </div>
                    </div>
                `;
                
                col.querySelector('.card').onclick = () => openHistoryDetail(item, docSnap.id);
                targetContainer.appendChild(col);

                // ดึงชื่อผู้ชนะ/ผู้ประมูลสูงสุด (ถ้ามี)
                // กรณี Sold: ใช้ buyer_uid (ถ้ามี) หรือ last_bidder_uid
                // กรณี Expired: ใช้ last_bidder_uid
                const winnerUid = item.buyer_uid || item.last_bidder_uid;

                if (winnerUid) {
                    promises.push(
                        getDoc(doc(db, "users", winnerUid)).then(userSnap => {
                            const winnerName = userSnap.exists() ? userSnap.data().displayName : "Unknown";
                            const winnerEl = document.getElementById(`winner-${docSnap.id}`);
                            if (winnerEl) {
                                let icon = isSold ? '<i class="bi bi-trophy-fill text-warning"></i>' : '<i class="bi bi-person-fill text-muted"></i>';
                                winnerEl.innerHTML = `<span class="small text-secondary">${icon} ${winnerName}</span>`;
                                // เก็บชื่อผู้ชนะไว้ใน object item เพื่อใช้ใน Modal
                                item.winner_name = winnerName; 
                            }
                        })
                    );
                }
            }
        });

        // อัปเดต UI
        loadingSection.style.display = 'none';
        historyContent.style.display = 'block';

        // อัปเดตตัวเลข
        document.getElementById('totalItems').innerText = soldCount;
        document.getElementById('totalRevenue').innerText = `฿${revenue.toLocaleString()}`;
        document.getElementById('soldCountBadge').innerText = soldCount;
        document.getElementById('expiredCountBadge').innerText = expiredCount;

        // แสดงข้อความเมื่อไม่มีรายการ
        if (soldCount === 0) document.getElementById('noSoldMsg').classList.remove('d-none');
        else document.getElementById('noSoldMsg').classList.add('d-none');

        if (expiredCount === 0) document.getElementById('noExpiredMsg').classList.remove('d-none');
        else document.getElementById('noExpiredMsg').classList.add('d-none');

        // รอให้โหลดชื่อผู้ชนะทั้งหมดเสร็จสิ้น
        await Promise.all(promises);

    } catch (error) {
        console.error("Load Error:", error);
        loadingSection.innerHTML = `<p class="text-center text-danger">เกิดข้อผิดพลาด: ${error.message}</p>`;
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
    
    const winnerEl = document.getElementById('detailWinner');
    const statusBadge = document.getElementById('detailStatusBadge');
    
    // ดึงชื่อจาก DOM (กรณีที่โหลดเสร็จแล้ว) หรือใช้จาก object
    // (ต้องระวังการดึง textContent อาจจะมี icon ปนมาด้วย เลยใช้ item.winner_name ดีกว่าถ้ามี)
    let winnerName = item.winner_name || "Unknown"; 

    if (item.status === 'sold') {
        statusBadge.innerText = "SOLD";
        statusBadge.className = "badge bg-success mb-2";
        winnerEl.innerText = winnerName;
        winnerEl.className = "text-warning fw-bold";
    } else {
        statusBadge.innerText = "EXPIRED";
        statusBadge.className = "badge bg-secondary mb-2";
        // ถ้ามีคนบิดแต่ไม่ถึงราคาขายสด/ไม่จบดีล
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

// ทำให้ฟังก์ชัน openHistoryDetail เรียกใช้ได้จาก HTML (onclick)
window.openHistoryDetail = openHistoryDetail;
