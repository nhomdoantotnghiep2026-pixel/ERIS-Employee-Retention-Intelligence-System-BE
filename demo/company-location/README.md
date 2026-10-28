# Cấu hình vị trí công ty để chấm công

Chạy backend rồi mở `http://localhost:3000/company-location-demo`.

1. Đăng nhập HR có tài khoản ACTIVE, employeeId và hồ sơ ACTIVE.
2. Nhập ít nhất 3 ký tự địa chỉ công ty, đợi gợi ý Vietmap rồi chọn. Bản đồ tự chuyển tới tọa độ của gợi ý. Có thể dùng phím lên/xuống và Enter.
3. Có thể lưu vị trí từ gợi ý hoặc bấm bản đồ, kéo ghim, dùng GPS để chỉnh. Nếu sửa địa chỉ, phải chọn lại gợi ý hoặc điểm trên bản đồ để không lưu nhầm tọa độ cũ. Có thể nhập tọa độ trực tiếp.
4. Kiểm tra điểm ghim và vòng tròn 100 m, tích xác nhận rồi lưu.
5. Check-in/check-out sẽ đọc vị trí mới ngay, không cần restart backend.

GPS cần localhost hoặc HTTPS và quyền vị trí của trình duyệt. GPS lấy vị trí thiết bị, không tự kiểm chứng địa chỉ công ty. Bản đồ dùng Leaflet/OpenStreetMap; không cần API key. Nếu bản đồ không tải được vẫn có thể nhập tọa độ hoặc lấy GPS.

## API

- `GET /api/v1/attendance/company-location`: xem vị trí để quản lý (HR có hồ sơ ACTIVE).
- `PUT /api/v1/attendance/company-location`: thay thế đủ address, latitude, longitude, cùng quyền như GET.
- `GET /api/v1/attendance/config`: nhân viên đủ quyền chấm công đọc tọa độ đang dùng.

```json
{
  "address": "Địa chỉ công ty",
  "latitude": 10.845106259160106,
  "longitude": 106.83894307850271
}
```

Redis key: `eris:attendance:company-location:v1`, không đặt TTL. Lưu thêm updatedAt và updatedBy (ID tài khoản HR), không phải audit history.

Khi key chưa có, dùng tọa độ môi trường hiện có. Khi Redis lỗi hoặc dữ liệu trong key không hợp lệ, API cấu hình và check-in/check-out trả 503, không âm thầm chuyển sang tọa độ khác. Nếu xóa key/flush Redis, hệ thống lại dùng cấu hình môi trường.

Cần giữ volume Redis và bật AOF hoặc cơ chế persistence phù hợp để cấu hình không mất sau khi tạo lại container. Không lưu API key hoặc token vào dữ liệu cấu hình. Các lần cập nhật đồng thời dùng giá trị được Redis ghi sau cùng.

Phạm vi thay đổi chỉ là địa điểm chấm công, giữ bán kính 100 m. Điểm đến của API distance chưa đổi theo cấu hình này. Không tạo thêm bảng/cột PostgreSQL, không thay đổi các bản ghi attendance cũ.

Chạy kiểm thử: `node test/company-location.test.cjs`.

Tham khảo bản đồ: https://leafletjs.com/examples/quick-start/ và https://operations.osmfoundation.org/policies/tiles/.

Gợi ý dùng lại GET /api/distance/places như địa chỉ nhà nhân viên: tối đa 5 kết quả kèm tọa độ. Chờ 400 ms sau khi dừng gõ, hủy request cũ và bỏ kết quả đến trễ. Không đưa Vietmap API key ra trình duyệt. Địa chỉ là nhãn do HR xác nhận, không tự reverse-geocode khi kéo ghim.
