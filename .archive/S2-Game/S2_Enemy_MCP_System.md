# 📘 S2 Enemy System

> Tài liệu về hệ thống cơ chế enemy trong game S2

---

## 1. Nhóm Chỉ Số Đánh Giá Độ Khó

| Nhóm Chỉ Số | Thuộc Tính (Stats) | Định Nghĩa Gameplay | Thang Điểm (MCP) |
|-------------|-------------------|---------------------|------------------|
| Learning Pattern | Steady ↔ Unsteady | Độ biến thiên của combo (Nhịp không đều, anticipate giả, combo dài ngắn bất thường) | +2.000 → +8.000 |
| Tempo Control | Slow ↔ Fast Pace | Tốc độ ra đòn thô. Fast đòi hỏi phản xạ (React), Slow/Delayed đòi hỏi trí nhớ (Memorize) | +1.500 → +5.000 |
| Engagement | Basic ↔ Counter | Basic: Thắng bằng kỹ năng cơ bản. Counter: Enemy có chiêu khắc chế kỹ năng/pháp bảo của Player | +3.000 → +12.000 |
| Interrupt | Unparryable Logic | Các đòn bắt buộc dùng Fulu Counter, nếu sai sẽ bị trừng phạt nặng | +5.000 → +10.000 |

---

## 2. Cơ Chế Gameplay (Mechanics)

### 2.1. Nhóm Phản Xạ

| Tên Cơ Chế | Mô tả Gameplay | Điểm MCP |
|------------|----------------|----------|
| **Perfect Deflect Chain** | Bắt buộc Parry liên tục chuỗi combo dài để không vỡ Stability | 1.500 |
| **Hard Guard Break** | Đòn đánh cực nặng, xuyên phá mọi lớp Block thường | 4.500 |

### 2.2. Nhóm Ngắt Chiêu

| Tên Cơ Chế | Mô tả Gameplay | Điểm MCP |
|------------|----------------|----------|
| **Unparryable Charge** | Boss vận chiêu đỏ/đen. Không thể né/đỡ, bắt buộc dùng Pháp bảo ngắt | 5.000 |
| **Consecutive Interrupt** | Chuỗi 2-3 đòn Unparryable liên tiếp, yêu cầu đổi Pháp bảo nhanh | 8.000 |

### 2.3. Nhóm Khống Chế

| Tên Cơ Chế | Mô tả Gameplay | Điểm MCP |
|------------|----------------|----------|
| **Artifact Silence** | Khóa hoàn toàn khả năng sử dụng Pháp bảo/Kỹ năng của người chơi | 12.000 |
| **Input Scramble** | Làm loạn các phím điều khiển (Trái ↔ Phải, Tiến ↔ Lùi) | 10.000 |
| **Stun/Impact Roar** | Gây choáng diện rộng hoặc làm khựng hoạt ảnh (Impact Frame) | 4.500 |

### 2.4. Nhóm Môi Trường

| Tên Cơ Chế | Mô tả Gameplay | Điểm MCP |
|------------|----------------|----------|
| **Gravity Field** | Làm chậm tốc độ di chuyển và tốc độ ra đòn của người chơi | 7.000 |
| **Arena Morphing** | Thay đổi cấu trúc địa hình, tạo mê cung hoặc bẫy | 9.000 |
| **Visual Illusion** | Tạo ảo ảnh, phân thân hoặc sương mù che khuất tầm nhìn | 6.000 |

---

## 3. Element Status (Trạng Thái Nguyên Tố)

| Nguyên Tố | Tên Tiếng Anh | Hiệu Ứng Gameplay | Điểm MCP |
|-----------|---------------|-------------------|----------|
| 🔥 **Hỏa** | Scorch | **Cháy (Burn)**: Gây X% sát thương phép liên tục mỗi T1 giây trong T2 giây | +1.500 |
| ⚡ **Lôi** | Electrified | **Điện giật**: Làm tăng sát thương nhận vào khi bị vỡ Stability. Gây stagger mỗi T2 giây | +2.500 |
| ☠️ **Độc** | Poison | **Suy nhược**: Gây sát thương + giảm hiệu quả hồi máu Y%. Làm chậm hồi thanh Pháp bảo | +3.500 |
| ❄️ **Băng** | Frozen | **Đông cứng**: Làm giảm tốc độ hoạt ảnh ra đòn (Attack Speed). Đóng băng mục tiêu T giây | +3.000 |
| 🌍 **Thổ** | Saturated | **Bão hòa**: Giảm 20% Damage Reduction trong 10 giây | +2.000 |

### Chi Tiết Ailment System

| Ailment | Cơ Chế Kích Hoạt | Thời Gian | Có Thể Xóa |
|---------|------------------|-----------|------------|
| Scorch | Build-Up meter → Full | T2 giây | Có (dodge) |
| Electrified | Build-Up meter → Full | T giây | Không |
| Poison | Build-Up meter → Full | T2 giây | Có (consumable) |
| Frozen | Build-Up meter → Full | T giây | Không |
| Saturated | Build-Up meter → Full | 10 giây | Không |

---

## 4. Loại Đòn Tấn Công Enemy

| Loại Đòn | Mô Tả | Parry | Dodge | Điểm MCP | Đặc Điểm |
|----------|-------|-------|-------|----------|----------|
| **Melee** | Đòn đánh cận chiến | ✅ | ✅ | +1.000 | Cơ bản, dễ parry. Damage Multiplier: 1.0x |
| **Charge Attack** | Lao đến ủi mục tiêu | ❌ (khó) | ✅ | +2.500 | Knock down, khó phản ứng. Damage: 1.0x+ |
| **Area of Effect** | Sát thương diện rộng | ❌ | ✅ | +3.000 | Cần đọc indicator, không parry được |
| **Projectile** | Bắn từ xa | ✅ (có thể) | ✅ | +1.500 | Tracking tùy enemy, có thể deflect |
| **Grab/Throw** | Chụp và ném | ❌ | ✅ | +4.000 | Damage cao, button mash để thoát |
| **Leap and Slam** | Nhảy và dậm | ❌ | ✅ | +3.500 | Shockwave diện rộng khi tiếp đất |
| **Phase Shift/Teleport** | Dịch chuyển tức thời | - | - | +2.000 | Gây mất dấu, invulnerability ngắn |
| **Summon** | Triệu hồi minion | - | - | +5.000 | Tăng số lượng enemy, vulnerable khi cast |
| **Parry** | Enemy đỡ đòn player | - | - | +3.000 | Chặn đòn + có thể counter attack |
| **Elemental Attack** | Đòn có nguyên tố | ✅ | ✅ | +2.000 | Apply status effect (Burn/Shock/Poison/Freeze) |

### Tổng Hợp Điểm MCP Theo Loại Đòn

| Mức Độ Nguy Hiểm | Loại Đòn | Điểm MCP |
|------------------|----------|----------|
| 🟢 **Thấp** | Melee | +1.000 |
| 🟢 **Thấp** | Projectile | +1.500 |
| 🟡 **Trung Bình** | Phase Shift/Teleport | +2.000 |
| 🟡 **Trung Bình** | Elemental Attack | +2.000 |
| 🟡 **Trung Bình** | Charge Attack | +2.500 |
| 🟠 **Cao** | Area of Effect | +3.000 |
| 🟠 **Cao** | Parry (Enemy) | +3.000 |
| 🟠 **Cao** | Leap and Slam | +3.500 |
| 🔴 **Rất Cao** | Grab/Throw | +4.000 |
| 🔴 **Rất Cao** | Summon | +5.000 |

---

## 5. Giai Đoạn Tấn Công (Attack Phases)

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  ANTICIPATION   │ →  │   PREPARATION   │ →  │     ATTACK      │ →  │    RECOVERY     │
│  (Dấu hiệu)     │    │  (Khóa đòn)     │    │  (Gây damage)   │    │  (Hồi phục)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
     ↑ Đọc đòn             ↑ Dodge/Parry          ↑ Hitbox active       ↑ Punish window
```

### Màu Sắc Feedback

| Màu | Ý Nghĩa |
|-----|---------|
| 🔴 **Đỏ** | Đòn không thể parry (Unblockable) |
| ⬜ **Không màu** | Đòn có thể parry |
| ⬛ **Đen** | Đòn charge đặc biệt (cần Pháp bảo ngắt) |

