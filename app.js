import { AuthService, UserService, AuctionService, StorageService } from "./api.js";

// Variables (คงเดิม)
let currentUser = null;
let currentIp = "Unknown";
let isBanned = false;
let userProfileCache = {};
let allProducts = []; 

let currentProductId = null;
let currentProductEndTime = null; 
let unsubscribeProduct = null;
let unsubscribeBids = null;
let currentSellerId = null;

// ==========================================
// A. ระบบค้นหา & กรองสินค้า (UI Logic คงเดิม)
// ==========================================
const searchInput = document.getElementById('searchInput');
const filterCategory = document.getElementById('filterCategory');
const sortOption = document.getElementById('sortOption');

if(searchInput) searchInput.addEventListener('input', applyFilters);
if(filterCategory) filterCategory.addEventListener('change', applyFilters);
if(sortOption) sortOption.addEventListener('change', applyFilters);

function applyFilters() {
    let result = [...allProducts];
    const keyword = searchInput.value.toLowerCase();
    if (keyword) result = result.filter(p => p.title.toLowerCase().includes(keyword));
    
    const category = filterCategory.value;
    if (category && category !== 'all') result = result.filter(p => p.category === category);
    
    const sortBy = sortOption.value;
    if (sortBy === 'newest') result.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
    else if (sortBy === 'ending_soon') {
        const now = new Date().getTime();
        result.sort((a, b) => (a.end_time - now) - (b.end_time - now));
    } else if (sortBy === 'price_asc') {
        result.sort((a, b) => (a.current_price || a.buy_now_price || 0) - (b.current_price || b.buy_now_price || 0));
    } else if (sortBy === 'price_desc') {
        result.sort((a, b) => (b.current_price || b.buy_now_price || 0) - (a.current_price || a.buy_now_price || 0));
    }
    
    renderProducts(result);
}

// 🔥 ฟังก์ชันแสดงผลสินค้า (UI Logic คงเดิม)
function renderProducts(products) {
    const listContainer = document.getElementById('productList');
    if(!listContainer) return;
    listContainer.innerHTML = "";
    
    if(products.length === 0) {
        listContainer.innerHTML = `
            <div class="col-12 text-center py-5 text-secondary opacity-50">
                <i class="bi bi-inbox display-1"></i>
                <p class="mt-3">ไม่พบสินค้าตามเงื่อนไข</p>
            </div>`;
        return;
    }

    // สร้างตัวแปรเก็บ HTML ก้อนใหญ่ไว้นอก Loop
    let allCardsHtml = ""; 

    products.forEach(item => {
        // ✅ item คือ Object ข้อมูลสินค้าเลย (ไม่ต้อง .data())
        const timerId = `timer-${item.id}`;
        const endTime = item.end_time ? new Date(item.end_time).getTime() : 0;
        
        let soldOverlay = item.status === 'sold' ? `<div class="sold-overlay"><div class="sold-text">SOLD</div></div>` : "";
        const catMap = { 'it': 'ไอที', 'fashion': 'แฟชั่น', 'amulet': 'พระเครื่อง', 'home': 'ของใช้', 'other': 'อื่นๆ' };
        const catName = catMap[item.category] || 'อื่นๆ';
        const sellerName = item.seller_name || "ผู้ขาย";

        // Logic ราคา
        let priceDisplayHtml = "";
        const currentPrice = item.current_price || 0;
        const buyNowPrice = item.buy_now_price || 0;
        const safeCurrentPrice = (item.current_price ?? 0).toLocaleString();
        const safeBuyNowPrice = (item.buy_now_price ?? 0).toLocaleString();

        if (buyNowPrice > 0 && currentPrice >= buyNowPrice) {
            priceDisplayHtml = `<p class="card-text text-danger fw-bold mb-2 h5">฿${safeCurrentPrice} (เกินราคาซื้อสด)</p>`;
        } else if (item.current_price !== null && item.current_price !== undefined) {
            priceDisplayHtml = `<p class="card-text text-danger fw-bold mb-2 h5">฿${safeCurrentPrice}</p>`;
        } else if (item.buy_now_price) {
            priceDisplayHtml = `<p class="card-text text-success fw-bold mb-2 h5">สด ฿${safeBuyNowPrice}</p>`;
        } else {
            priceDisplayHtml = `<p class="card-text text-muted mb-2 small">รอราคาเปิด</p>`;
        }

        const safeTitleForAlt = item.title.replace(/"/g, '&quot;'); 

        allCardsHtml += `
            <div class="col-6 col-md-4 col-lg-3">
                <div class="card h-100 cursor-pointer position-relative card-custom" onclick="openAuction('${item.id}')">
                    ${soldOverlay}
                    <div class="product-img-wrapper"> 
                        <img src="${item.image_url}" class="product-img-list" alt="${safeTitleForAlt}" onerror="this.src='https://via.placeholder.com/300?text=No+Image'">
                        <div class="position-absolute top-0 start-0 p-2">
                            <span class="badge bg-light text-dark shadow-sm opacity-75">${catName}</span>
                        </div>
                    </div>
                    <div class="card-body p-3">
                        <h6 class="card-title text-truncate fw-bold mb-1">${item.title}</h6>
                        ${priceDisplayHtml}
                        <div class="d-flex justify-content-between align-items-center mt-2">
                            <small class="text-secondary text-truncate" style="max-width: 80px;"><i class="bi bi-person"></i> ${sellerName}</small>
                            <div class="text-warning small fw-bold">
                                <i class="bi bi-clock"></i> 
                                <span id="${timerId}" class="card-timer" data-end-time="${endTime}">--:--</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    listContainer.innerHTML = allCardsHtml;
}


// ==========================================
// B. Dashboard (เรียก Service เพื่อคำนวณ)
// ==========================================

window.openDashboardModal = async function() {
    // 1. เช็ค Login
    if(!currentUser) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'กรุณาเข้าสู่ระบบ',
                    confirmButtonColor: '#ff6b6b'
                });
    
    // 2. เปิด Modal และแสดง Loading
    new bootstrap.Modal(document.getElementById('dashboardModal')).show();
    const mySellingContainer = document.getElementById('mySellingList');
    const myBiddingContainer = document.getElementById('myBiddingList');
    
    mySellingContainer.innerHTML = loadSpinner("กำลังโหลดรายการขาย...");
    myBiddingContainer.innerHTML = loadSpinner("กำลังโหลดรายการประมูล...");

    try {
        // 3. เรียกข้อมูลจาก Python Backend 🚀
        const data = await UserService.getDashboardData();
        
        // 4. Render: รายการที่ขาย (Selling)
        renderMySelling(data.selling, mySellingContainer);
        
        // 5. Render: รายการที่ประมูล (Bidding)
        renderMyBidding(data.bidding, myBiddingContainer);

    } catch (error) {
        console.error(error);
        mySellingContainer.innerHTML = `<p class="text-danger text-center py-3">เกิดข้อผิดพลาด: ${error.message}</p>`;
        myBiddingContainer.innerHTML = "";
    }
}

// --- Helper Functions สำหรับ Render HTML ---

function loadSpinner(text) {
    return `<div class="col-12 text-center py-5"><div class="spinner-border text-danger" role="status"></div><p class="text-secondary mt-3 small">${text}</p></div>`;
}

function renderMySelling(items, container) {
    container.innerHTML = "";
    if (items.length === 0) {
        container.innerHTML = "<p class='text-center w-100 small text-secondary py-3'>คุณยังไม่ได้ลงขายสินค้า</p>";
        return;
    }

    items.forEach(item => {
        const statusBadge = item.status === 'sold' ? '<span class="badge bg-success">ขายแล้ว</span>' : '<span class="badge bg-primary">กำลังขาย</span>';
        const price = item.current_price || item.buy_now_price || 0;
        
        container.innerHTML += `
            <div class="col-12 col-md-6">
                <div class="border p-2 rounded bg-white shadow-sm d-flex gap-3 align-items-center" onclick="openAuction('${item.id}', '${item.title}', ${price}, '${item.image_url}', '')" style="cursor:pointer">
                    <img src="${item.image_url}" style="width:60px; height:60px; object-fit:cover" class="rounded bg-light">
                    <div style="overflow:hidden" class="flex-grow-1">
                        <div class="text-truncate fw-bold text-dark">${item.title}</div>
                        <div class="d-flex justify-content-between align-items-center mt-1">
                            <span class="text-danger fw-bold">฿${price.toLocaleString()}</span>
                            ${statusBadge}
                        </div>
                    </div>
                </div>
            </div>`;
    });
}

function renderMyBidding(list, container) {
    container.innerHTML = "";
    if (list.length === 0) {
        container.innerHTML = "<p class='text-center w-100 small text-secondary py-3'>คุณยังไม่ได้ร่วมประมูลสินค้าใดๆ</p>";
        return;
    }

    list.forEach(data => {
        const item = data.item;
        const myRank = data.my_rank;
        const myMaxBid = data.my_max_bid;
        const isWinner = data.is_winner;

        let rankClass = "bg-light text-secondary";
        let rankText = "กำลังแข่ง";
        
        if (isWinner) { 
            rankClass = "bg-success text-white"; 
            rankText = "🏆 ชนะประมูล!"; 
        } else if (item.status === 'sold') {
            rankClass = "bg-secondary text-white";
            rankText = "❌ แพ้";
        } else if (myRank === 1) { 
            rankClass = "bg-warning text-dark"; 
            rankText = "🥇 ผู้นำสูงสุด"; 
        } else {
            rankText = "รองจ่าฝูง";
        }

        const currentP = item.current_price || item.buy_now_price || 0;

        container.innerHTML += `
            <div class="col-12 col-md-6">
                <div class="border p-2 rounded bg-white shadow-sm d-flex gap-3 align-items-center" onclick="openAuction('${item.id}', '${item.title}', ${currentP}, '${item.image_url}', '')" style="cursor:pointer">
                    <img src="${item.image_url}" style="width:70px; height:70px; object-fit:cover" class="rounded bg-light">
                    <div style="overflow:hidden" class="flex-grow-1">
                        <div class="text-truncate fw-bold text-dark mb-1">${item.title}</div>
                        <div class="d-flex justify-content-between align-items-center">
                            <div><span class="badge ${rankClass}">${rankText}</span></div>
                            <div class="text-end">
                                <div class="small text-secondary" style="font-size:0.7rem;">ราคาปัจจุบัน</div>
                                <div class="text-danger fw-bold">฿${currentP.toLocaleString()}</div>
                            </div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-2 border-top pt-1">
                            <span class="small text-muted" style="font-size:0.75rem;">เสนอไป: ฿${myMaxBid.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>`;
    });
}

// ==========================================
// C. Load Products (ใช้ Service)
// ==========================================
function loadProducts() {
    const listContainer = document.getElementById('productList');
    if(!listContainer) return;
    
    // 🔥 รับมาเป็น Array ตรงๆ (productsArray)
    AuctionService.subscribeAuctions((productsArray) => {
        allProducts = [];
        productsArray.forEach((item) => {
            // ✅ item คือ object ข้อมูลเลย
            const isSold = item.status === 'sold';
            const endTimeVal = item.end_time ? new Date(item.end_time).getTime() : 0;
            const isExpired = endTimeVal > 0 && new Date().getTime() > endTimeVal;

            if (!isSold && !isExpired) {
                allProducts.push(item);
            }
        });
        applyFilters();
    });
}
loadProducts();

// ==========================================
// D. Auth & User System (ใช้ Service)
// ==========================================
async function initSystem() { 
    try { 
        currentIp = await AuthService.getClientIp();
    } catch (e) { } 
}
initSystem();

window.logoutSystem = async function() { 
    Swal.fire({
        title: 'ออกจากระบบ?',
        text: "คุณต้องการ Log out ใช่หรือไม่",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff6b6b', 
        cancelButtonColor: '#b2bec3',
        confirmButtonText: 'ใช่, ออกเลย',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await AuthService.logout(); 
            window.location.reload();
        }
    }); 
}


AuthService.onUserChange(async (user) => {
    if (user) {
        currentUser = user;
        const btnLogin = document.getElementById('btnLogin'); 
        const btnLogout = document.getElementById('btnLogout');
        if (btnLogin && btnLogout) {
            if (user.is_anonymous) { btnLogin.classList.remove('d-none'); btnLogout.classList.add('d-none'); } 
            else { btnLogin.classList.add('d-none'); btnLogout.classList.remove('d-none'); }
        }

        // ✅ รับ object ตรงๆ หรือ null
        const userProfile = await UserService.getUserProfile(user.id);
        
        const savedSecret = localStorage.getItem('my_guest_secret');
        const isNewIdentity = user.is_anonymous && savedSecret && 
                             (!userProfile || userProfile.secret_code !== savedSecret); // ✅ เช็ค null แทน .exists()

        if (isNewIdentity) {
            console.log("Found old secret:", savedSecret);
            Swal.fire({
                title: 'พบข้อมูลเดิมในเครื่อง!',
                text: 'คุณเคยใช้งานบัญชี Guest ไว้ ต้องการกู้คืนข้อมูลเดิมหรือไม่?',
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#1dd1a1',
                confirmButtonText: 'ใช่! กู้คืนข้อมูลเดิม',
                cancelButtonText: 'ไม่ (เริ่มใหม่ทั้งหมด)'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        const oldName = await UserService.recoverAccount(user, savedSecret);
                        localStorage.setItem('my_guest_secret', userProfile?.secret_code || savedSecret);
                        Swal.fire('ยินดีต้อนรับกลับ', `คุณ ${oldName}`, 'success').then(()=> window.location.reload());
                    } catch (e) {
                        Swal.fire('กู้คืนไม่สำเร็จ', 'ข้อมูลเก่าอาจถูกลบไปแล้ว', 'error');
                        localStorage.removeItem('my_guest_secret');
                    }
                } else {
                    localStorage.removeItem('my_guest_secret');
                    if(userProfile) localStorage.setItem('my_guest_secret', userProfile.secret_code);
                    window.location.reload();
                }
            });
        } 
        
        // ✅ เช็คถ้า userProfile ไม่เป็น null
        if (userProfile) {
            setupUserProfile(userProfile);
            UserService.subscribeProfile(user.id, (updatedProfile) => { 
                if (updatedProfile) setupUserProfile(updatedProfile); // ✅ รับ object ตรงๆ
            });
        } else {
             setupNewGuestProfile(user);
        }

    } else {
        AuthService.loginAnonymous().catch(console.error);
    }
});

// ฟังก์ชันแยกออกมาเพื่อความสะอาด (สร้าง Profile ใหม่)
async function setupNewGuestProfile(user) {
    if (!user || !user.id) return;
    console.log("✅ Guest Profile handled by Database Trigger for:", user.id);
    
    UserService.subscribeProfile(user.id, (updatedProfile) => { 
        if (updatedProfile) { // ✅ เช็ค object
            setupUserProfile(updatedProfile); 
        }
    }); 
}

function setupUserProfile(data) { 
    // data คือ object แล้ว ใช้ได้เลย
    userProfileCache = data; 
    isBanned = data.is_banned; 

    updateUIName(data.username); 

    if(document.getElementById('profileSecretCode')) { 
        document.getElementById('profileSecretCode').value = data.secret_code || ""; 
        document.getElementById('profileEmail').value = data.contact_email || ""; 
    }

    if (currentUser && currentUser.is_anonymous && data.secret_code) {
        const oldSecret = localStorage.getItem('my_guest_secret');
        if (!oldSecret || oldSecret === data.secret_code) {
             localStorage.setItem('my_guest_secret', data.secret_code);
        }
    }
    // ส่วนจัดการปุ่ม Link Account (ใส่ ? ป้องกัน Error ถ้า providerData เป็น null)
    const isLinked = currentUser?.providerData?.some(p => p.providerId === 'password'); 
    const linkSection = document.getElementById('linkAccountSection'); 
    
    if(isLinked && linkSection) { 
        linkSection.innerHTML = `<div class="text-success text-center py-2"><i class="bi bi-check-circle-fill"></i> บัญชีนี้ผูกกับอีเมลแล้ว</div>`; 
    } 

    // ถ้าโดนแบน ให้ล้างหน้าจอทิ้งเลย
    if(isBanned) {
        document.body.innerHTML = "<div class='vh-100 d-flex justify-content-center align-items-center bg-danger'><h1 class='text-white'>🚫 BANNED</h1></div>"; 
    }
    
}

function updateUIName(name) { 
    const el = document.getElementById('navUsername'); 
    if(el) el.innerText = name; 
}

// ==========================================
// Timer Logic (ทำงานถูกต้องแล้วครับ)
// ==========================================
setInterval(() => { 
    const modal = document.getElementById('auctionModal'); 
    // อัปเดตเวลาใน Modal (ถ้าเปิดอยู่)
    if (currentProductEndTime && modal && modal.classList.contains('show')) { 
        updateTimerUI(currentProductEndTime, 'modalTimer', 'modalTimerBadge', true); 
    } 
    // อัปเดตเวลาในการ์ดหน้าแรก
    document.querySelectorAll('.card-timer').forEach(el => { 
        const endTime = Number(el.dataset.endTime); 
        const badgeId = el.id.replace('timer-', 'badge-'); 
        updateTimerUI(endTime, el.id, badgeId, false); 
    }); 
}, 1000);

function updateTimerUI(endTimeMs, textId, badgeId, isModal) { 
    const now = new Date().getTime(); 
    const distance = endTimeMs - now; 
    const textEl = document.getElementById(textId); 
    const badgeEl = document.getElementById(badgeId); 
    
    if (!textEl) return; 

    // กรณีหมดเวลา
    if (distance < 0) { 
        textEl.innerText = "ปิดประมูลแล้ว"; 
        
        if(badgeEl) { 
            badgeEl.className = "badge bg-secondary"; 
            // แก้สีข้อความในการ์ดให้เป็นสีแดงเพื่อเน้น
            if(badgeEl.parentElement.classList.contains('text-warning')) { 
                badgeEl.parentElement.className = "text-danger small fw-bold"; 
            } 
        } 
        
        // ถ้าเป็น Modal ให้ซ่อนปุ่มบิด/ซื้อ
        if(isModal) { 
            document.getElementById('bidControlSection').classList.add('d-none'); 
            document.getElementById('buyNowSection').classList.add('d-none'); 
            
            // ถ้ายังไม่ขึ้น Sold ให้ขึ้นว่าปิดประมูล
            if(document.getElementById('soldBadge').classList.contains('d-none')) { 
                document.getElementById('auctionEndedMsg').classList.remove('d-none'); 
            } else { 
                document.getElementById('auctionEndedMsg').classList.add('d-none'); 
            } 
        } 
    } else { 
        // กรณีเวลายังเดินอยู่
        const days = Math.floor(distance / (1000 * 60 * 60 * 24)); 
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)); 
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)); 
        const seconds = Math.floor((distance % (1000 * 60)) / 1000); 
        
        let timeString = ""; 
        if(days > 0) timeString += `${days}วัน `; 
        timeString += `${hours}ชม. ${minutes}น. ${seconds}วิ.`; 
        
        textEl.innerText = timeString; 
        
        // ถ้าเหลือเวลา < 5 นาที ให้กระพริบเตือน (Animation Flash)
        if(distance < 5 * 60 * 1000 && badgeEl) { 
            badgeEl.className = "badge bg-danger animate__animated animate__flash"; 
        } 
    } 
}
// ==========================================
// F. Modal Logic (ใช้ Service)
// ==========================================
window.openAuction = function(id, title, price, img, desc) {
    const itemFromCache = allProducts.find(p => p.id === id);
    const safeTitle = title || itemFromCache?.title || "กำลังโหลด...";
    const safeImg = img || itemFromCache?.image_url || "https://via.placeholder.com/300?text=No+Image"; 
    const safeDesc = desc || itemFromCache?.description || "";
    
    currentProductId = id;
    
    document.getElementById('modalTitle').innerText = safeTitle;
    document.getElementById('modalImage').src = safeImg; 
    document.getElementById('modalDesc').innerText = safeDesc;

    // 4. รีเซ็ต UI ส่วนอื่นๆ
    document.getElementById('bidInput').value = "";
    document.getElementById('bidHistoryList').innerHTML = "<div class='text-center small mt-4 text-secondary'>กำลังโหลดประวัติ...</div>";
    
    document.getElementById('bidControlSection').classList.add('d-none');
    document.getElementById('buyNowSection').classList.add('d-none');
    document.getElementById('auctionEndedMsg').classList.add('d-none');
    document.getElementById('soldMsg').classList.add('d-none');
    document.getElementById('soldBadge').classList.add('d-none');
    
    document.getElementById('modalSellerName').innerText = "กำลังโหลด...";
    document.getElementById('modalEmailLink').classList.add('d-none');
    document.getElementById('modalEditBtn').classList.add('d-none');
    document.getElementById('modalCategoryBadge').innerText = "หมวดหมู่";

    if (unsubscribeProduct) unsubscribeProduct();
    if (unsubscribeBids) unsubscribeBids();

    // 🔥 Subscribe สินค้า
    unsubscribeProduct = AuctionService.subscribeAuctionDetail(id, (data) => {
        // ✅ data คือ Object หรือ null
        if (data) {
            currentSellerId = data.seller_id;

            const modalPrice = document.getElementById('modalPrice');
            if (data.current_price !== null && data.current_price !== undefined) {
                modalPrice.innerText = `฿${data.current_price.toLocaleString()}`;
                modalPrice.className = "display-6 fw-bold text-danger";
            } else if (data.buy_now_price) {
                modalPrice.innerText = `฿${data.buy_now_price.toLocaleString()}`;
                modalPrice.className = "display-6 fw-bold text-success";
            } else {
                modalPrice.innerText = "-";
            }

            document.getElementById('modalTitle').innerText = data.title;
            if(data.image_url) document.getElementById('modalImage').src = data.image_url;
            document.getElementById('modalDesc').innerText = data.description;

            if(data.end_time) currentProductEndTime = new Date(data.end_time).getTime(); // แปลงเวลา
            
            if(data.contact_email) {
                document.getElementById('modalEmailLink').href = `mailto:${data.contact_email}`;
                document.getElementById('modalEmailLink').classList.remove('d-none');
            }
            
            const catMap = { 'it': 'ไอที', 'fashion': 'แฟชั่น', 'amulet': 'พระเครื่อง', 'home': 'ของใช้', 'other': 'อื่นๆ' };
            document.getElementById('modalCategoryBadge').innerText = catMap[data.category] || 'สินค้าทั่วไป';

            // Seller Name
            if (data.seller_name) {
                document.getElementById('modalSellerName').innerText = data.seller_name;
            } else if(data.seller_id) {
                UserService.getUserProfile(data.seller_id).then(uProfile => {
                    if(uProfile) document.getElementById('modalSellerName').innerText = uProfile.username;
                });
            }

            // ปุ่มแก้ไข
            if (currentUser && currentUser.id === data.seller_id && data.status !== 'sold') {
                document.getElementById('modalEditBtn').classList.remove('d-none');
            } else {
                document.getElementById('modalEditBtn').classList.add('d-none');
            }

            // Sold / Buy Now Status
            if (data.status === 'sold') {
                document.getElementById('soldBadge').classList.remove('d-none');
                document.getElementById('soldMsg').classList.remove('d-none');
                currentProductEndTime = 0; 
            } else {
                if (data.buy_now_price && data.buy_now_price > 0) {
                    document.getElementById('buyNowSection').classList.remove('d-none');
                    document.getElementById('buyNowPriceDisplay').innerText = `฿${data.buy_now_price.toLocaleString()}`;
                }
                if (data.current_price !== null && data.current_price !== undefined) {
                    document.getElementById('bidControlSection').classList.remove('d-none');
                }
            }
        }
    });

    // 🔥 Subscribe Bids (รับ Array ตรงๆ)
    unsubscribeBids = AuctionService.subscribeBids(id, (bidsArray) => {
        const historyList = document.getElementById('bidHistoryList');
        if(document.getElementById('bidCount')) document.getElementById('bidCount').innerText = bidsArray.length; // ✅ .length
        
        historyList.innerHTML = "";
        if (bidsArray.length === 0) {
            historyList.innerHTML = "<div class='text-center text-secondary small mt-2'>ยังไม่มีข้อเสนอ<br>เป็นคนแรกสิ!</div>";
        } else {
            bidsArray.forEach((bid) => {
                // ✅ bid คือ Object
                const bidTime = bid.created_at ? new Date(bid.created_at) : new Date();
                const timeStr = bidTime.toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'});
                
                let bidderName = "Unknown";
                if (bid.profiles && bid.profiles.username) {
                    bidderName = bid.profiles.username;
                } else if (bid.bidder_name) {
                    bidderName = bid.bidder_name;
                }

                const html = `
                    <div class="d-flex justify-content-between border-bottom py-2 px-2 align-items-center">
                        <div class="d-flex align-items-center gap-2">
                            <i class="bi bi-person-circle text-secondary"></i>
                            <div>
                                <div class="text-dark fw-bold small">${bidderName}</div>
                                <small class="text-secondary" style="font-size: 0.65rem;">${timeStr}</small>
                            </div>
                        </div>
                        <div class="text-success fw-bold">฿${Number(bid.amount).toLocaleString()}</div>
                    </div>
                `;
                historyList.innerHTML += html;
            });
        }
    });

    new bootstrap.Modal(document.getElementById('auctionModal')).show();
}

// ==========================================
// G. Add & Edit Item (ใช้ Service)
// ==========================================

const addForm = document.getElementById('addItemForm');
if(addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if(checkBan()) return;
        
        const title = document.getElementById('inpTitle').value;
        const priceVal = document.getElementById('inpPrice').value;
        const buyNowVal = document.getElementById('inpBuyNowPrice').value;
        const bidIncrementVal = document.getElementById('inpBidIncrement').value;
        const bidIncrement = bidIncrementVal ? Number(bidIncrementVal) : 20;
        
        const price = priceVal !== "" ? Number(priceVal) : null;
        const buyNowPrice = buyNowVal !== "" ? Number(buyNowVal) : null;
        
        if (price === null && buyNowPrice === null) {
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: 'กรุณาระบุ ราคาเริ่มต้น หรือ ราคาขายสด อย่างน้อย 1 อย่าง',
                        confirmButtonColor: '#ff6b6b'
                    });
        }

        const email = document.getElementById('inpEmail').value.trim();
        const fileInput = document.getElementById('inpFile');
        const endTimeInput = document.getElementById('inpEndTime').value;
        
        if (!email || !endTimeInput || fileInput.files.length === 0) 
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: 'กรอกข้อมูลให้ครบ',
                        confirmButtonColor: '#ff6b6b'
                    });
        const endTimeMs = new Date(endTimeInput).getTime();
        if (endTimeMs <= new Date().getTime()) 
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: '❌ เวลาปิดประมูลต้องเป็นอนาคต',
                        confirmButtonColor: '#ff6b6b'
                    });

        try {
            toggleLoading(true);
           const file = fileInput.files[0];
    
            // 1. Upload รูป
            const imageUrl = await StorageService.uploadImage(file);

            // 2. สร้างสินค้า (ส่งแค่ข้อมูลที่ User กรอก + ค่าที่คำนวณได้)
            // ⚠️ ไม่ต้องแปลงชื่อตัวแปรให้ตรง DB ตรงนี้ เดี๋ยวให้ api.js ทำให้
            await AuctionService.createAuction({
                title: title, 
                category: document.getElementById('inpCategory').value || "other", 
                description: document.getElementById('inpDesc').value, 
                
                // ราคา
                current_price: price, 
                buy_now_price: buyNowPrice,
                bid_increment: bidIncrement, // ส่งชื่อนี้ไป เดี๋ยว api.js แปลงเป็น min_bid_increment เอง
                
                // ข้อมูลติดต่อ
                contact_email: email,
                image_url: imageUrl, 
                
                // ผู้ขาย
                seller_id: currentUser ? currentUser.id : "guest", 
                // seller_name ไม่ต้องส่งก็ได้ (เพราะ DB ไม่เก็บ) หรือจะส่งไปแล้วให้ api.js ลบออกก็ได้
                
                // เวลา (ส่งเป็น ms ไปเลย ง่ายกว่า)
                end_time: endTimeMs, // ✅ แก้จาก data.end_time เป็น endTimeMs
                
                // start_time ไม่ต้องส่ง เดี๋ยว api.js สร้างเวลาปัจจุบันให้
                status: 'active'
            });

            
            
            toggleLoading(false); 
            Swal.fire({
                icon: 'success',
                title: 'สำเร็จ!',
                text: 'ลงสินค้าเรียบร้อย',
                confirmButtonColor: '#1dd1a1'
            }); 
            location.reload(); 
        } catch (error) { 
            toggleLoading(false); 
            Swal.fire({
                icon: 'error',
                title: 'เกิดข้อผิดพลาด',
                text: error.message,
                confirmButtonColor: '#ff6b6b'
            });("Error: " + error.message); 
        }
    });
}

const editForm = document.getElementById('editItemForm');
if(editForm) {
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const endTimeInput = document.getElementById('editEndTime').value;
        const endTimeMs = new Date(endTimeInput).getTime();
        if (endTimeMs <= new Date().getTime()) 
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: '❌ เวลาปิดประมูลต้องเป็นอนาคต',
                        confirmButtonColor: '#ff6b6b'
                    });
        
        const pid = document.getElementById('editProductId').value;
        const fileInput = document.getElementById('editFile');
        const buyNowVal = document.getElementById('editBuyNowPrice').value;
        const buyNowPrice = buyNowVal ? Number(buyNowVal) : null;

        try {
        toggleLoading(true);
        let imageUrl = document.getElementById('currentImageUrl').value; 
        
        // เช็คว่ามีการอัปโหลดรูปใหม่ไหม
        if (fileInput.files.length > 0) {
            // 🔥 เรียก Service: Upload
            imageUrl = await StorageService.uploadImage(fileInput.files[0]);
        }

        // 🔥 เรียก Service: Update Auction
        await AuctionService.updateAuction(pid, {
            title: document.getElementById('editTitle').value, 
            description: document.getElementById('editDesc').value,
            category: document.getElementById('editCategory').value || "other",
            buy_now_price: buyNowPrice,
            image_url: imageUrl, 
            contact_email: document.getElementById('editEmail').value, 
            
            // ✅ แก้ตรงนี้: เปลี่ยน key เป็น end_time_ms เพื่อให้ api.js รู้ว่าเป็นตัวเลข
            end_time: endTimeMs
            });
            toggleLoading(false); 
                Swal.fire({
                    icon: 'success',
                    title: 'สำเร็จ!',
                    text: 'แก้ไขเรียบร้อย!',
                    confirmButtonColor: '#1dd1a1' // สีธีมเรา
                });
            bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide(); 
            location.reload();
            
        }   catch(e) { toggleLoading(false); 
                Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: e.message,
                    confirmButtonColor: '#ff6b6b'
                });}
    });
}

window.openEditModal = async function() {
    if(!currentProductId) return;
    bootstrap.Modal.getInstance(document.getElementById('auctionModal')).hide();
    toggleLoading(true);
    
    // 🔥 รับ Object ตรงๆ
    const data = await AuctionService.getAuctionById(currentProductId);
    
    if(data) {
        if (currentUser.id !== data.seller_id) {
            toggleLoading(false);
            return Swal.fire({ icon: 'error', title: 'ห้ามแก้ไข', text: 'คุณไม่ใช่เจ้าของสินค้านี้' });
        }
        document.getElementById('editProductId').value = currentProductId;
        document.getElementById('editTitle').value = data.title;
        document.getElementById('editDesc').value = data.description;
        document.getElementById('editCategory').value = data.category || "other"; 
        document.getElementById('editPrice').value = data.current_price; 
        document.getElementById('editBuyNowPrice').value = data.buy_now_price || "";
        document.getElementById('currentImageUrl').value = data.image_url;
        
        const safeImageUrl = data.image_url || "";
        document.getElementById('currentImageUrl').value = safeImageUrl;

        const imgDisplay = document.getElementById('editCurrentImgDisplay'); 
        if (imgDisplay) {
            imgDisplay.src = safeImageUrl || 'https://via.placeholder.com/150?text=No+Image';
        }
        document.getElementById('editFile').value = "";
        document.getElementById('editEmail').value = data.contact_email || "";
        if(data.end_time) {
            const date = new Date(data.end_time);
            const tzOffset = date.getTimezoneOffset() * 60000; 
            const localISOTime = (new Date(date - tzOffset)).toISOString().slice(0, 16);
            document.getElementById('editEndTime').value = localISOTime;
        }
        toggleLoading(false);
        new bootstrap.Modal(document.getElementById('editItemModal')).show();
    }
}

// ==========================================
// Actions: Bid & Buy Now (ใช้ Service)
// ==========================================
function toggleLoading(show) { 
    const loader = document.getElementById('loading'); 
    if (loader) loader.style.display = show ? 'flex' : 'none'; 
}

window.placeBid = async function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'กรุณากู้คืนบัญชีเดิมก่อน',
                    confirmButtonColor: '#ff6b6b'   
                });
    if(currentUser && currentSellerId === currentUser.id) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'คุณประมูลสินค้าตัวเองไม่ได้!',
                    confirmButtonColor: '#ff6b6b'   
                });
    const bidInput = document.getElementById('bidInput');
    const bidAmount = Number(bidInput.value);
    if(!bidAmount || bidAmount <= 0) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'กรุณาใส่ราคา',
                    confirmButtonColor: '#ff6b6b'   
                });
    try {
        const data = await AuctionService.getAuctionById(currentProductId); // ✅ ได้ object
        if (data) {
            const now = new Date().getTime();
            const endTime = data.end_time ? new Date(data.end_time).getTime() : 0; // แปลงเวลา

            if (data.status === 'sold') return Swal.fire({ icon: 'error', title: 'อุ๊ปส์...', text: 'สินค้านี้ขายแล้ว!' });
            if (endTime && now > endTime) return Swal.fire({ icon: 'error', title: 'อุ๊ปส์...', text: 'หมดเวลาแล้ว!' });
            
            const currentP = data.current_price || 0;
            const minIncrement = data.bid_increment || 20;
            let minAllowedPrice = currentP + minIncrement;
            if (currentP === 0) minAllowedPrice = data.current_price;

            if (Number(document.getElementById('bidInput').value) < minAllowedPrice) {
                 return Swal.fire({ 
                    icon: 'error', 
                    title: 'ราคาต่ำไป', 
                    text: `ต้องเสนอราคาเพิ่มขึ้นอย่างน้อย ฿${minIncrement.toLocaleString()} (ขั้นต่ำต้องใส่ ฿${(currentP + minIncrement).toLocaleString()})`, 
                    confirmButtonColor: '#ff6b6b' });
            }
            if (bidAmount <= currentP) 
                return Swal.fire({
                            icon: 'error',
                            title: 'อุ๊ปส์...',
                            text: `ต้องใส่ราคามากกว่า ฿${currentP.toLocaleString()}`,
                            confirmButtonColor: '#ff6b6b'
                        });

            const myName = document.getElementById('navUsername').innerText;
            await AuctionService.placeBid(currentProductId, {
                amount: Number(document.getElementById('bidInput').value), 
                bidder_id: currentUser.id, 
                bidder_name: myName
            });
            document.getElementById('bidInput').value = "";
        }
    } catch (error) { Swal.fire({
                        icon: 'error',
                        title: 'อุ๊ปส์...',
                        text: error.message, 
                        confirmButtonColor: '#ff6b6b'
                    }); }
}

window.buyNow = async function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) 
        return Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: "กรุณากู้คืนบัญชีเดิมก่อน", 
            confirmButtonColor: '#ff6b6b'
        });
    if(currentUser && currentSellerId === currentUser.id) 
        return Swal.fire({
            icon: 'error',
            title: 'อุ๊ปส์...',
            text: "คุณซื้อสินค้าตัวเองไม่ได้!", 
            confirmButtonColor: '#ff6b6b'
        });

    // 🛑 แก้ไขตรงนี้: ต้องรอผลลัพธ์จาก Swal ก่อน
    Swal.fire({
        title: 'ยืนยันการซื้อสด ?',
        text: "คุณต้องการซื้อสด ใช่หรือไม่",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#1dd1a1', // ✅ แนะนำให้สีปุ่มตกลงเป็นสีเขียว (User จะได้ไม่งง)
        cancelButtonColor: '#b2bec3',
        confirmButtonText: 'ใช่, ซื้อเลย',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        // ✅ ถ้ากดตกลง ค่อยทำงานต่อ
        if (result.isConfirmed) {
            try {
                // แสดง Loading ระหว่างรอ
                Swal.showLoading();

                const data = await AuctionService.getAuctionById(currentProductId);
                
                if (data) {
                    const currentP = data.current_price || 0;
                    if (data.buy_now_price && currentP >= data.buy_now_price) {
                        return Swal.fire({ icon: 'error', text: "ราคาประมูลปัจจุบันสูงกว่าราคาขายสดแล้ว" });
                    }
                    if (data.status === 'sold') 
                        return Swal.fire({
                            icon: 'error',
                            title: 'อุ๊ปส์...',
                            text: "เสียใจด้วย มีคนซื้อตัดหน้าไปแล้ว!", 
                            confirmButtonColor: '#ff6b6b'
                        });
                    
                    const myName = document.getElementById('navUsername').innerText;
                    await AuctionService.buyNow(currentProductId, {
                        amount: data.buy_now_price,
                        winner_id: currentUser.id,
                        bidder_name: myName
                    });
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'เรียบร้อย!',
                        text: ' ซื้อสินค้าสำเร็จ! ยินดีด้วย 🎉🎉',
                        confirmButtonColor: '#1dd1a1',
                        confirmButtonText: 'ตกลง'
                    });
                }
            } catch (error) { 
                Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: error.message,
                    confirmButtonColor: '#ff6b6b'
                });
            }
        }
    });
}

window.openAddModal = function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) 
        return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'กรุณากู้คืนบัญชีเดิมก่อนใช้งาน',
                    confirmButtonColor: '#ff6b6b'
                });
    document.getElementById('addItemForm').reset();
    setupProfileCheckbox('chkProfileEmail', userProfileCache.contact_email);
    if(userProfileCache.contact_email) document.getElementById('chkProfileEmail').click();
    new bootstrap.Modal(document.getElementById('addItemModal')).show();
}

function setupProfileCheckbox(chkId, dataValue) { const chk = document.getElementById(chkId); if (!dataValue) { chk.disabled = true; chk.parentElement.querySelector('label').innerText += " (ไม่มี)"; } else { chk.disabled = false; let label = chk.parentElement.querySelector('label').innerText; chk.parentElement.querySelector('label').innerText = label.replace(" (ไม่มี)", ""); } }
window.toggleContactInput = function(chkId, inputId, dataKey) { const isChecked = document.getElementById(chkId).checked; const inputEl = document.getElementById(inputId); if (isChecked) { inputEl.value = userProfileCache[dataKey] || ""; inputEl.readOnly = true; inputEl.classList.add('bg-secondary', 'text-white'); } else { inputEl.value = ""; inputEl.readOnly = false; inputEl.classList.remove('bg-secondary', 'text-white'); } }
window.openProfileModal = function() { if(!currentUser) return; document.getElementById('profileNameInput').value = document.getElementById('navUsername').innerText; new bootstrap.Modal(document.getElementById('profileModal')).show(); }

window.updateUserProfile = async function() { 
    const newName = document.getElementById('profileNameInput').value; 
    if(newName && currentUser) { 
        toggleLoading(true); 
        // 🔥 เรียก Service
        await UserService.updateProfile(currentUser.id, { 
            username: newName, 
            contact_email: document.getElementById('profileEmail').value 
        }); 
        updateUIName(newName);
        if(userProfileCache) userProfileCache.username = newName;
        
        toggleLoading(false); 
        Swal.fire({
            icon: 'success',
            title: 'เรียบร้อย!',
            text: 'บันทึกข้อมูลเรียบร้อย🎉',
            confirmButtonColor: '#1dd1a1', // สีเขียวมิ้นต์ตามธีมเว็บคุณ
            confirmButtonText: 'ตกลง'
        });
        bootstrap.Modal.getInstance(document.getElementById('profileModal')).hide(); 
    } 
}

window.linkAccount = async function() { 
    const email = document.getElementById('linkEmail').value.trim(); 
    const password = document.getElementById('linkPassword').value; 
    if(!email || password.length < 6) 
        return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'กรอกอีเมลและรหัสผ่าน (6 ตัวขึ้นไป)',
                    confirmButtonColor: '#ff6b6b'
                }); 
    try { 
        toggleLoading(true); 
        // 🔥 เรียก Service
        await AuthService.linkEmailAccount(currentUser, email, password);
        const currentName = document.getElementById('navUsername').innerText; // ดึงชื่อปัจจุบันมาด้วย

        await UserService.updateProfile(currentUser.id, { 
            username: currentName, // <--- ต้องส่งอันนี้ไปด้วย เพราะ Backend บังคับ
            contact_email: email 
        });
        toggleLoading(false); 
        Swal.fire({
            icon: 'success',
            title: 'เรียบร้อย ✅',
            text: 'ผูกบัญชีสำเร็จ! 🎉',
            confirmButtonColor: '#1dd1a1', // สีเขียวมิ้นต์ตามธีมเว็บคุณ
            confirmButtonText: 'ตกลง'
        });(" "); document.getElementById('linkAccountSection').innerHTML = `<div class="text-success text-center py-2"><i class="bi bi-check-circle-fill"></i> บัญชีนี้ผูกกับอีเมลแล้ว</div>`; 
    } catch (error) { toggleLoading(false); 
        Swal.fire({
            icon: 'error',
            title: 'อุ๊ปส์...',
            text: error.message,
            confirmButtonColor: '#ff6b6b'
        });} 
}

window.copySecret = function() { 
    const copyText = document.getElementById("profileSecretCode"); 
    copyText.select(); 
    navigator.clipboard.writeText(copyText.value); 
    Swal.fire({
            icon: 'success',
            title: 'เรียบร้อย!',
            text: 'คัดลอกรหัสลับแล้ว',
            confirmButtonColor: '#1dd1a1', 
            confirmButtonText: 'ตกลง'
        });
}
window.openRecoverModal = function() {
     new bootstrap.Modal(document.getElementById('recoverModal')).show();
    }

window.recoverAccount = async function() { 
    const secretCode = document.getElementById('recoverSecretCode').value.trim(); 
    if(!secretCode) 
        return  Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'กรุณากรอกรหัสลับ', 
                    confirmButtonColor: '#ff6b6b'
                }); 
    try { 
        toggleLoading(true); 
        // 🔥 เรียก Service (รวม logic ย้ายข้อมูลไว้ใน api.js แล้ว)
        const oldName = await UserService.recoverAccount(currentUser, secretCode);
        toggleLoading(false); 
        Swal.fire({
            icon: 'success',
            title: 'ย้ายสำเร็จ!',
            text: `ยินดีต้อนรับ ${oldName}🎉`,
            confirmButtonColor: '#1dd1a1',
            confirmButtonText: 'ตกลง'
        }); location.reload();

    } catch (error) { toggleLoading(false); 
        Swal.fire({
            icon: 'error',
            title: 'อุ๊ปส์...',
            text: error.message,
            confirmButtonColor: '#ff6b6b'
        }); } 
}

function checkBan() { 
    if(isBanned) { 
        Swal.fire({
            icon: 'error',
            title: 'อุ๊ปส์...',
            text: 'คุณถูกระงับการใช้งาน',
            confirmButtonColor: '#ff6b6b'
        }); 
        return true; } 
        return false; }

// ✅ เช็ค URL ว่ามีการส่งรหัสสินค้ามาไหม ถ้ามีให้เปิด Modal ทันที
document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedItemId = urlParams.get('item_id');

    if (sharedItemId) {
        // รอสักนิดให้ระบบโหลดพื้นฐานเสร็จ
        setTimeout(async () => {
            const docSnap = await AuctionService.getAuctionById(sharedItemId);
            if (docSnap.exists()) {
                const item = docSnap.data();
                const price = item.current_price || item.buy_now_price || 0;
                // เปิด Modal สินค้า
                openAuction(sharedItemId, item.title, price, item.image_url, item.description);
            }
        }, 1000);
    }
});        


// ฟังก์ชันสำหรับกดปุ่ม "แชร์" ใน Modal สินค้า
window.shareAuction = function() {
    if (!currentProductId) return;

    const backendUrl = "https://auction-backend-1089558422014.asia-southeast1.run.app"; // 🔴 ใส่ URL Backend จริง
    const shareUrl = `${backendUrl}/share/${currentProductId}`;

    // Copy ลง Clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
        Swal.fire({
            icon: 'success',
            title: 'คัดลอกลิ้งค์แล้ว!',
            text: 'นำไปวางใน Facebook/Line ได้เลย✨',
            confirmButtonColor: '#1dd1a1'
        });
    }).catch(err => {
        // กรณี Browser ไม่รองรับการ Copy อัตโนมัติ ให้แสดง URL ให้คนกด copy เอง
        Swal.fire({
            title: 'คัดลอกลิ้งค์ด้านล่าง',
            html: `<input type="text" value="${shareUrl}" class="form-control text-center" readonly>`,
            confirmButtonColor: '#ff6b6b'
        });
    });
}
