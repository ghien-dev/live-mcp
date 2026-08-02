# Thư mục hỏi–đáp chuyên gia

Nơi ghi lại những vấn đề kỹ thuật mà đội phát triển Live MCP không tự giải được, và câu trả lời từ chuyên gia. Làm việc bất đồng bộ: người hỏi và người trả lời không cần có mặt cùng lúc.

## Nếu bạn là chuyên gia được mời trả lời

1. Mở [`INDEX.md`](INDEX.md) xem toàn cảnh. Cột **Mức độ** cho biết nên ưu tiên câu nào: `chặn` là đang dừng tiến độ, `quan-trọng` là sẽ chặn sớm, `tham-khảo` là để định hướng dài hạn.
2. Mở file `Qxx-*.md` tương ứng. Đọc mục 1–4.
3. Viết câu trả lời **dưới dải `═══ TRẢ LỜI ═══`**, trong một mục `###` mang tên bạn và ngày.
4. Cập nhật `trạng_thái`, `người_trả_lời`, `ngày_trả_lời` ở frontmatter, và dòng tương ứng trong `INDEX.md`.

Trả lời được câu nào hay câu đó — không cần trả lời hết một file. Ghi rõ câu nào bạn bỏ qua là đủ.

Nếu thấy câu hỏi đặt sai đề, cứ nói thẳng trong phần trả lời. Đó là loại phản hồi có giá trị nhất.

## Quy tắc

**Chuyên gia chỉ viết dưới dải `═══ TRẢ LỜI ═══`.** Không sửa mục 1–4. Giữ nguyên phần câu hỏi để về sau còn truy được "lúc đó chúng tôi hiểu vấn đề như thế nào" — đó thường là thông tin quý hơn cả câu trả lời.

**Claude không sửa phần trả lời**, chỉ viết vào mục 5 (Ghi nhận & áp dụng) những gì đã thay đổi trong mã sau khi đọc.

**Nhiều chuyên gia thì mỗi người một mục `###` riêng.** Không ghi đè lên nhau. Ý kiến trái chiều được giữ lại nguyên vẹn — chúng thường chỉ ra chỗ vấn đề thật sự khó.

**Câu hỏi mới nảy ra từ một câu trả lời thì mở file `Q` mới**, ghi `liên_quan: Qxx` ở frontmatter. Không nối đuôi vô hạn vào file cũ.

**Đổi `trạng_thái` ở frontmatter thì phải đổi cả `INDEX.md`.** Chỉ một chỗ nhìn là biết toàn cảnh.

## Đặt tên

`Q<số 2 chữ số>-<slug-không-dấu>.md`

Số thứ tự tăng dần và **không bao giờ tái sử dụng**, kể cả khi một câu hỏi bị huỷ. Nhờ vậy trích dẫn "Q03" ở bất kỳ đâu — commit message, chat, tài liệu khác — cũng không bao giờ trỏ nhầm.

Ngày tháng không nằm trong tên file: nó làm tên dài và gây hiểu nhầm đó là ngày trả lời. Ngày nằm ở frontmatter và `INDEX.md`.

## Vòng đời một câu hỏi

```
chờ-trả-lời  →  đã-trả-lời  →  đang-áp-dụng  →  khép-lại
                                    │
                                    └─→ (nảy ra câu hỏi mới) → Q mới
```

`huỷ` dành cho câu hỏi trở nên không còn ý nghĩa — vẫn giữ file lại, chỉ đổi trạng thái, kèm một dòng lý do ở mục 5.
