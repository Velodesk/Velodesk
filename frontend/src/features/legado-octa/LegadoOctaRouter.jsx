import React from 'react';
import { Route, Routes } from 'react-router-dom';
import LegadoOctaListPage from './LegadoOctaListPage';
import LegadoOctaDetailPage from './LegadoOctaDetailPage';

export default function LegadoOctaRouter() {
  return (
    <Routes>
      <Route index element={<LegadoOctaListPage />} />
      <Route path="ticket/:number" element={<LegadoOctaDetailPage />} />
    </Routes>
  );
}
