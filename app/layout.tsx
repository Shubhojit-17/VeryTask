import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VeryTask | Hyper-Local Gig Economy on Very Chain",
  description: "A decentralized TaskRabbit alternative. Post tasks, earn VERY tokens, build your reputation on the blockchain.",
  keywords: ["Very Chain", "blockchain", "gig economy", "decentralized", "tasks", "crypto", "Web3"],
  authors: [{ name: "VeryTask Team" }],
  openGraph: {
    title: "VeryTask - Hyper-Local Gig Economy",
    description: "Post tasks, earn crypto. Decentralized gig economy on Very Chain.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-slate-900 text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
