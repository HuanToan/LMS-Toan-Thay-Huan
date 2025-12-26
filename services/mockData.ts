import { Question, User } from '../types';

export const MOCK_USERS: User[] = [
  { email: 'nguyenvana@thayphuctoandongnai.edu.vn', name: 'Nguyễn Văn A', class: '12A1', totalScore: 850, avatar: 'https://picsum.photos/200' },
  { email: 'tranb@thayphuctoandongnai.edu.vn', name: 'Trần Thị B', class: '11B2', totalScore: 920, avatar: 'https://picsum.photos/201' },
  { email: 'leclong@thayphuctoandongnai.edu.vn', name: 'Lê Cường Long', class: '10C3', totalScore: 740, avatar: 'https://picsum.photos/202' },
];

export const MOCK_QUESTIONS: Question[] = [
  {
    exam_id: 'Q001',
    level: 'Vận dụng',
    question_type: 'Trắc nghiệm',
    question_text: 'Tìm tập xác định D của hàm số y = (x+1)/(x-1).',
    option_A: 'D = R \\ {1}',
    option_B: 'D = R \\ {-1}',
    option_C: 'D = R',
    option_D: 'D = (1; +vc)',
    answer_key: 'A',
    solution: 'Hàm số xác định khi mẫu số khác 0, tức là x - 1 ≠ 0 <=> x ≠ 1.',
    topic: 'Hàm số',
    grade: 10
  },
  {
    exam_id: 'Q002',
    level: 'Thông hiểu',
    question_type: 'Trắc nghiệm',
    question_text: 'Nghiệm của phương trình 2x - 4 = 0 là:',
    option_A: 'x = 1',
    option_B: 'x = 2',
    option_C: 'x = -2',
    option_D: 'x = 4',
    answer_key: 'B',
    solution: '2x - 4 = 0 <=> 2x = 4 <=> x = 2.',
    topic: 'Phương trình',
    grade: 10
  },
  {
    exam_id: 'Q003',
    level: 'Vận dụng cao',
    question_type: 'Trắc nghiệm',
    question_text: 'Cho hình chóp S.ABCD có đáy là hình vuông cạnh a, SA vuông góc với đáy, SA = a. Tính thể tích khối chóp.',
    option_A: 'a^3/3',
    option_B: 'a^3',
    option_C: 'a^3/2',
    option_D: 'a^3/6',
    answer_key: 'A',
    solution: 'V = 1/3 * S_day * h = 1/3 * a^2 * a = a^3/3.',
    topic: 'Hình học không gian',
    grade: 12
  }
];