// 데이터 키(D18) 만들기: 32바이트 무작위 값을 base64로 출력한다. 내 PC에서 한 번 실행 → GitHub Secrets DATA_KEY와 앱 설정 "데이터 키"에 같은 값.
// 값은 화면에만 나오고 파일로 저장하지 않는다. 다른 사람에게 보내지 말 것.
import { webcrypto } from 'node:crypto';
const b = webcrypto.getRandomValues(new Uint8Array(32));
process.stdout.write(Buffer.from(b).toString('base64') + '\n');
