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
    const listContainer = document.getElementById('historyList');
    if (!listContainer) return;

    const now = new Date().getTime();

    try {
        // ดึงข้อมูลสินค้าทั้งหมด เรียงตามเวลาล่าสุด
        const q = query(collection(db, "auctions"), orderBy("created_at", "desc"));
        const snapshot = await getDocs(q);
        
        listContainer.innerHTML = "";
        
        let count = 0;
        let revenue = 0;
        let promises = []; // เก็บ Promise สำหรับการดึงชื่อผู้ชนะ

        snapshot.forEach(docSnap => {
            const item = docSnap.data();
            const isSold = item.status === 'sold';
            const isExpired = item.end_time_ms && now > item.end_time_ms;

            // กรองเฉพาะสินค้าที่ จบแล้ว (ขายแล้ว หรือ หมดเวลา)
            if (isSold || isExpired) {
                count++;
                if (isSold) revenue += (item.current_price || 0);
                
                // สร้าง Element การ์ดสินค้า
                const col = document.createElement('div');
                col.className = "col-12 col-md-6 col-lg-4 col-xl-3";
                
                let statusBadge = isSold ? 
                    `<span class="sold-badge">SOLD <i class="bi bi-check-lg"></i></span>` : 
                    `<span class="expired-badge">EXPIRED</span>`;
                
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
                                    ${isSold ? '<span class="spinner-border spinner-border-sm" style="width:0.7rem; height:0.7rem;"></span> หาผู้ชนะ...' : 'ไม่มีผู้ชนะ'}
                                </div>
                                <small class="text-secondary" style="font-size: 0.7rem;">${dateStr}</small>
                            </div>
                        </div>
                    </div>
                `;
                
                // เพิ่ม Event Click เพื่อเปิด Modal รายละเอียด
                col.querySelector('.card').onclick = () => openHistoryDetail(item, docSnap.id);
                
                listContainer.appendChild(col);

                // ถ้าขายแล้ว ให้ไปดึงชื่อผู้ชนะมาแสดง
                if (isSold && item.buyer_uid) {
                    promises.push(
                        getDoc(doc(db, "users", item.buyer_uid)).then(userSnap => {
                            const winnerName = userSnap.exists() ? userSnap.data().displayName : "Unknown";
                            const winnerEl = document.getElementById(`winner-${docSnap.id}`);
                            if (winnerEl) {
                                winnerEl.innerHTML = `<span class="winner-badge"><i class="bi bi-trophy-fill"></i> ${winnerName}</span>`;
                                // เก็บชื่อผู้ชนะไว้ใน object item เพื่อใช้ใน Modal
                                item.winner_name = winnerName; 
                            }
                        })
                    );
                }
            }
        });

        // อัปเดตสรุปยอด
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

        // รอให้โหลดชื่อผู้ชนะทั้งหมดเสร็จสิ้น
        await Promise.all(promises);

    } catch (error) {
        console.error("Load Error:", error);
        listContainer.innerHTML = `<p class="text-center text-danger">เกิดข้อผิดพลาด: ${error.message}</p>`;
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
    
    if (item.status === 'sold') {
        // ถ้ามีชื่อผู้ชนะที่โหลดมาแล้ว ให้ใช้เลย หรือลองดึงจาก DOM
        const domWinner = document.getElementById(`winner-${id}`)?.innerText;
        winnerEl.innerText = item.winner_name || domWinner || "กำลังโหลด...";
        winnerEl.className = "text-warning fw-bold";
    } else {
        winnerEl.innerText = "ไม่มีผู้ชนะ (หมดเวลา)";
        winnerEl.className = "text-secondary";
    }

    detailModal.show();
}
