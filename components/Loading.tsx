import React from 'react';

const Loading: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-teal-600 mb-4"></div>
      <p className="text-teal-700 font-semibold text-lg animate-pulse">Đang tìm bài toán thú vị...</p>
    </div>
  );
};

export default Loading;