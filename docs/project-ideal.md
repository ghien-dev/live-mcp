# Mô tả ý tưởng Live MCP

Live MCP là một local server cầu nối, giúp AI Agent như Claude, ChatGPT kết nối với một trang web bất kỳ hỗ trợ *chuẩn Live MCP*, bằng việc tự động expose danh sách tools và functions của trang web dựa vào các khai báo *chuẩn Live MCP*

## chuẩn Live MCP

Là một tiêu chuẩn declarative phần tử html mở rộng dựa vào ý tưởng webmcp https://developer.chrome.com/docs/ai/webmcp/declarative-api

Mục tiêu của Live MCP là phát triển bộ chuẩn declarative nâng cao, cùng với những kỹ thuật đặc biệt để đảm bảo một trang web đúng chuẩn sử dụng 100% declarative và AI agent có thể hoàn thành tác vụ dựa vào declarative và sự hỗ trợ từ thư viện tương tác sự kiện của Live MCP, chuẩn Live MCP đặt mục tiêu loại bỏ sự cần thiết của  https://developer.chrome.com/docs/ai/webmcp/imperative-api

## Suy nghĩ của chủ dự án
Ti đang tìm mọi cách để loại bỏ Imperative, tôi muốn tìm giải pháp để làm hoàn toàn bằng declarative. Vấn đề tạo DOM node mới tại runtime: hãy suy nghĩ thật kỹ, DOM mới được sinh ra từ tương tác người dùng chứ nó hoàn toàn không tự sinh ra mà không có tương tác, hãy chú ý Agent hoàn toàn có thể nhận declarative mới từ DOM mới bằng một sự kiện đợi sau khi gọi hành động, ví dụ hành động dropdown click sinh ra từ declarative là của một dropdown, khi agent gửi hành động click vào nó thì đợi nó trả về 1 list item (cũng đã được declarative nhưng là vừa mới sinh ra sau hành động click), tức là agent phải học cách đợi của Playwright, và trang web tiếp tục sinh ra phần tử mới cũng được declarative và phát sự kiện cập nhật declarative, tức chúng ta không có Imperative nhưng sẽ có những hàm chung toàn cục phục vụ cho declarative.

Hãy cùng suy nghĩ cách để tọa giải pháp thuần declarative, giúp agent tương tác y như con người, tức là có hành cộng bằng chuột và bàn phím, tất cả phải thông qua hành động như vậy không gọi javascript, tôi ủng hộ suy luận vì con người hoàn thành được luồng công việc mà không cần gọi javascript thì agent cũng phải làm được như vậy, bác bỏ sự cần thiết của Imperative, trừ khi giao diện được thiết kế không dành cho con người tương tác, đó là logic suy luận

## Định hướng kỹ thuật mô hình đầy đủ của Live MCP bao gồm:

- Live MCP Local Server: toàn bộ AI agent sẽ tương tác với Live MCP Local Server 100% thông qua websocket mà không cần biết trang web đích
- Live MCP Chrome Extenstion: Sẽ nhận lệnh trực tiếp từ Live MCP Local Server để thực hiện các hành động như click (right/left), typeping .. cụ thể, và có trách nhiệm lắng nghe mọi thay đổi của DOM (chỉ lọc theo declarative) để gửi về cho Live MCP Server (nó sẽ tiếp tục tương tác với AI Agent)

## Về trải nghiệm người dùng:

- Một trang web có hỗ trợ Live MCP sẽ được Live MCP Chrome Extenstion nhận dạng ngay lập tức và tiến hành kết nối với Live MCP Local Server để khai báo/trình báo tất cả những declarative của nó), Live MCP Local Server sẽ phân tích và tạo ra cấu trúc dạng listTools, registerTool... (ý tôi là nó sẽ chuẩn hóa theo đúng chuẩn MCP của Anthropic), từ đó tạo ra một Live MCP Server cho web đó mà Agent AI có thể kết nối realtime ngay tại thời điểm nó được load vào trình duyệt.

- Người dùng sẽ gửi yêu cầu cho Agent AI, nó dựa vào Live MCP Server đã khai báo để phân tích gọi tools, đợi kết quả và tiếp tục gọi tool cho đến khi hoàn thành công việc. Tools nó gọi sẽ được Live MCP Server gửi tới Live MCP Extenstion.

- Phía Live MCP Extenstion: khi tạo thao tác giả lập người dùng, tôi muốn nó có một hình con ong nhỏ (thay cho hình mouse) bay tới vị trí cần tương tác, chân trái, chân phải của con ong tương ứng hành động mouse, còn mủi kim từ miệng ong tượng trưng cho cây bút nó sẽ đẩy lên xuống khi type text



