import { RouterProvider } from 'react-router';
import { useAuthBootstrap } from '@/lib/auth/use-auth';
import { router } from './router';

export function App() {
  useAuthBootstrap();
  return <RouterProvider router={router} />;
}
