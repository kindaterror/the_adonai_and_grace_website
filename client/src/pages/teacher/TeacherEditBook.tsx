// src/pages/teacher/TeacherEditBook.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { PageForm, PageFormValues } from "@/components/admin/PageForm";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  ArrowLeft,
  Loader2,
  GraduationCap,
  Edit3,
  BookOpen,
  Image as ImageIcon,
} from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import Header from "@/components/layout/Header";
import { motion, AnimatePresence } from "@/lib/motionShim";

/* =================== Helpers (Cloudinary upload) =================== */
function getToken() {
  if (typeof window === "undefined") return null;
  const t = localStorage.getItem("token");
  return t && t !== "null" ? t : null;
}

async function uploadToCloudinary(
  file: File,
  folder: string,
  kind?: "book_cover" | "page_audio"
) {
  const fd = new FormData();
  fd.append("file", file);
  if (kind) fd.append("kind", kind);

  const token = getToken();
  const resp = await fetch(`/api/upload?folder=${encodeURIComponent(folder)}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });

  const data = await resp.json();
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || "Upload failed");
  }
  // IMPORTANT: returns { success, url, publicId }
  return data as { success: true; url: string; publicId: string };
}

/* =================== Validation =================== */
const editBookSchema = z
  .object({
    title: z.string().min(2, "Title must be at least 2 characters"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    coverImage: z.string().optional(),
    coverPublicId: z.string().optional(), // 👈 add publicId in form state
    type: z.enum(["storybook", "educational"]),
    subject: z.string().optional(),
    grade: z.string().optional(),
    musicUrl: z.string().optional(),
    quizMode: z.enum(["retry", "straight"]).default("retry"),
  })
  .superRefine((val, ctx) => {
    if (val.type === "educational" && (!val.subject || val.subject.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Subject is required for educational books",
        path: ["subject"],
      });
    }
  });

type EditBookFormValues = z.infer<typeof editBookSchema>;

/* =================== Badges types =================== */
type Badge = {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
};

type BookBadgeMapping = {
  badgeId: number;
  isEnabled: boolean;
  awardMethod: "auto_on_book_complete" | "manual";
  completionThreshold: number; // 1..100
};

/* =================== Motion =================== */
const fadeIn = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};
const fadeInFast = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const itemFade = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: "easeIn" } },
};

export default function TeacherEditBook() {
  const { id } = useParams<{ id: string }>();
  const bookId = parseInt(id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /* ========== Local state ========== */
  const [pages, setPages] = useState<PageFormValues[]>([]);
  const [shuffleAll] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);

  // badges
  const [badgeMappings, setBadgeMappings] = useState<Record<number, BookBadgeMapping>>({});
  const badgesSeededRef = useRef(false);

  /* ========== Queries ========== */
  const { data: bookData, isLoading: isLoadingBook } = useQuery({
    queryKey: [`/api/books/${bookId}`],
    queryFn: async () => {
      const response = await apiRequest<{ book: any }>("GET", `/api/books/${bookId}`);
      if (response && response.book) return response.book;
      throw new Error("Failed to fetch book data");
    },
    enabled: !!bookId,
  });

  const { data: pagesData, isLoading: isLoadingPages } = useQuery({
    queryKey: [`/api/books/${bookId}/pages`],
    queryFn: async () => {
      const response = await apiRequest<{ pages: any[] }>("GET", `/api/books/${bookId}/pages`);
      return response?.pages ?? [];
    },
    enabled: !!bookId,
  });

  // all badges
  const { data: allBadges = [], isLoading: isLoadingBadges } = useQuery<Badge[]>({
    queryKey: ["/api/badges"],
    queryFn: async () => {
      const res = await apiRequest<{ badges: Badge[] }>("GET", `/api/badges`);
      return res?.badges ?? [];
    },
  });

  // existing mappings (tolerate 404)
  const { data: bookBadgeData = [], isLoading: isLoadingBookBadges } = useQuery<BookBadgeMapping[]>({
    queryKey: [`/api/books/${bookId}/book-badges`],
    queryFn: async () => {
      try {
        const res = await apiRequest<{ mappings: BookBadgeMapping[] }>("GET", `/api/books/${bookId}/book-badges`);
        return res?.mappings ?? [];
      } catch (e: any) {
        if ((e as any)?.status === 404) return [];
        throw e;
      }
    },
    enabled: !!bookId,
  });

  /* ========== Form ========== */
  const form = useForm<EditBookFormValues>({
    resolver: zodResolver(editBookSchema),
    defaultValues: {
      title: "",
      description: "",
      coverImage: "",
      coverPublicId: "", // 👈 keep in form state
      type: "storybook",
      subject: "",
      grade: "",
      musicUrl: "",
      quizMode: "retry",
    },
  });

  useEffect(() => {
    if (bookData) {
      form.reset({
        title: bookData.title || "",
        description: bookData.description || "",
        coverImage: bookData.coverImage || "",
        coverPublicId: bookData.coverPublicId || "", // 👈 seed from API if present
        type: bookData.type || "storybook",
        subject: bookData.subject || "",
        grade: bookData.grade || "",
        musicUrl: bookData.musicUrl || "",
        quizMode: bookData.quizMode || "retry",
      });
    }
  }, [bookData, form]);

  useEffect(() => {
    if (Array.isArray(pagesData)) {
      const formatted = pagesData.map((p: any) => ({
        id: p.id,
        pageNumber: p.pageNumber,
        title: p.title || "",
        content: p.content || "",
        imageUrl: p.imageUrl || "",
        imagePublicId: p.imagePublicId || "",
        questions: p.questions || [],
      }));
      setPages(formatted);
    }
  }, [pagesData]);

  // seed badge mappings once
  useEffect(() => {
    if (badgesSeededRef.current) return;
    if (isLoadingBadges || isLoadingBookBadges) return;

    const rec: Record<number, BookBadgeMapping> = {};
    for (const b of allBadges) {
      rec[b.id] = {
        badgeId: b.id,
        isEnabled: false,
        awardMethod: "auto_on_book_complete",
        completionThreshold: 100,
      };
    }
    for (const m of bookBadgeData) {
      rec[m.badgeId] = {
        ...(rec[m.badgeId] ?? {
          badgeId: m.badgeId,
          isEnabled: false,
          awardMethod: "auto_on_book_complete",
          completionThreshold: 100,
        }),
        ...m,
      };
    }
    setBadgeMappings(rec);
    badgesSeededRef.current = true;
  }, [isLoadingBadges, isLoadingBookBadges, allBadges, bookBadgeData]);

  const mappingsArray = useMemo(() => allBadges.map((b) => badgeMappings[b.id]).filter(Boolean), [
    allBadges,
    badgeMappings,
  ]);

  /* ========== Mutations ========== */
  const updateBookMutation = useMutation({
    mutationFn: async (data: EditBookFormValues) => {
      const clean = {
        title: data.title?.trim() || "",
        description: data.description?.trim() || "",
        type: data.type,
        subject: data.type === "educational" ? data.subject || null : null,
        grade: data.grade || "",
        coverImage: data.coverImage || "",
        coverPublicId: data.coverPublicId || "", // 👈 include publicId when updating
        musicUrl: data.musicUrl || "",
        quizMode: data.quizMode ?? "retry",
      };
      return await apiRequest("PUT", `/api/books/${bookId}`, clean);
    },
    onSuccess: () => {
      toast({ title: "✅ Book Updated", description: "The book has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      queryClient.invalidateQueries({ queryKey: [`/api/books/${bookId}`] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "❌ Error",
        description: error?.message || "Failed to update book",
      });
    },
  });

  const updatePagesMutation = useMutation({
    mutationFn: async (pageData: PageFormValues) => {
      if (pageData.id) {
        return await apiRequest("PUT", `/api/pages/${pageData.id}`, pageData);
      }
      return await apiRequest("POST", `/api/books/${bookId}/pages`, {
        ...pageData,
        bookId,
        shuffleQuestions: shuffleAll,
      });
    },
    onSuccess: () => {
      toast({ title: "✅ Page Updated", description: "The page has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: [`/api/books/${bookId}/pages`] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "❌ Error",
        description: error?.message || "Failed to update page",
      });
    },
  });

  const deletePageMutation = useMutation({
    mutationFn: async (pageId: number) => await apiRequest("DELETE", `/api/pages/${pageId}`),
    onSuccess: () => {
      toast({ title: "✅ Page Deleted", description: "The page has been deleted successfully." });
      queryClient.invalidateQueries({ queryKey: [`/api/books/${bookId}/pages`] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "❌ Error",
        description: error?.message || "Failed to delete page",
      });
    },
  });

  // save badge mappings (skip if endpoint missing)
  const saveBadgesMutation = useMutation({
    mutationFn: async () => {
      const mappings = Object.values(badgeMappings);
      try {
        return await apiRequest("PUT", `/api/books/${bookId}/book-badges`, { mappings });
      } catch (e: any) {
        if ((e as any)?.status === 404) return { skipped: true };
        throw e;
      }
    },
    onSuccess: (res: any) => {
      if (!res?.skipped) {
        toast({ title: "🏅 Badges Updated", description: "Badge settings for this book have been saved." });
        queryClient.invalidateQueries({ queryKey: [`/api/books/${bookId}/book-badges`] });
      }
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "❌ Error", description: error?.message || "Failed to save badges" });
    },
  });

  /* ========== Submit ========== */
  const onSubmit = async (data: EditBookFormValues) => {
    try {
      if (!data.title?.trim()) {
        toast({ variant: "destructive", title: "❌ Validation Error", description: "Title is required" });
        return;
      }
      if (!data.description?.trim()) {
        toast({ variant: "destructive", title: "❌ Validation Error", description: "Description is required" });
        return;
      }

      await updateBookMutation.mutateAsync(data);
      for (const page of pages) await updatePagesMutation.mutateAsync(page);
      await saveBadgesMutation.mutateAsync();

      navigate("/teacher/books");
    } catch {
      /* handled by mutations */
    }
  };

  /* ========== Page CRUD helpers ========== */
  const handleAddPage = () => {
    const newPageNumber = pages.length > 0 ? Math.max(...pages.map((p) => p.pageNumber)) + 1 : 1;
    const newPage: PageFormValues = { pageNumber: newPageNumber, title: "", content: "", imageUrl: "", imagePublicId: "", questions: [] };
    setPages([...pages, newPage]);
  };

  const handlePageSave = (pageData: PageFormValues) => {
    setPages((prev) => prev.map((p) => (p.pageNumber === pageData.pageNumber ? pageData : p)));
    if (pageData.showNotification) {
      toast({
        title: "✅ Page Saved",
        description: 'Page changes saved locally. Click "Save Changes" to update the book.',
      });
    }
  };

  const handleRemovePage = (pageNumber: number) => {
    const pageToRemove = pages.find((p) => p.pageNumber === pageNumber);
    if (pageToRemove && pageToRemove.id) deletePageMutation.mutate(pageToRemove.id);
    setPages(pages.filter((p) => p.pageNumber !== pageNumber));
  };

  const isSaving =
    updateBookMutation.isPending ||
    updatePagesMutation.isPending ||
    saveBadgesMutation.isPending ||
    coverUploading ||
    audioUploading;

  /* ========== Loading / Not found ========== */
  if (isLoadingBook || isLoadingPages) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-navy-50 via-ilaw-white to-brand-gold-50">
        <Header variant="teacher" />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 bg-white rounded-2xl p-6 border-2 border-brand-navy-200 shadow-xl">
            <Loader2 className="h-10 w-10 animate-spin text-ilaw-gold" />
            <p className="text-base font-heading font-bold text-ilaw-navy">Loading book data...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!bookData && !isLoadingBook) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-navy-50 via-ilaw-white to-brand-gold-50">
        <Header variant="teacher" />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 bg-white rounded-2xl p-6 border-2 border-red-200 shadow-xl">
            <p className="text-base font-heading font-bold text-red-600">❌ Book not found</p>
            <Button onClick={() => navigate("/teacher/books")} variant="outline">Back to Books</Button>
          </div>
        </main>
      </div>
    );
  }

  /* ========== Render ========== */
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-navy-50 via-ilaw-white to-brand-gold-50">
      <Header variant="teacher" />

      {/* Banner (teacher theme) */}
      <motion.div
        variants={fadeIn}
        initial="hidden"
        animate="visible"
        className="bg-gradient-to-r from-ilaw-navy to-brand-navy-800 text-white py-8 shadow-md relative overflow-hidden"
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/0 via-white/5 to-white/0 [mask-image:radial-gradient(60%_60%_at_15%_20%,black,transparent)]" />
        <div className="container mx-auto px-4 relative">
          <div className="flex items-center justify-center mb-3">
            <GraduationCap className="h-7 w-7 text-ilaw-gold mr-2" />
            <span className="text-sm font-sans font-bold text-ilaw-gold tracking-wide uppercase">
              Adonai And Grace Inc.
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-sans font-bold text-center">✏️ Edit Book</h1>
          <p className="text-blue-100 text-center font-sans font-bold">Update your educational content</p>

          {/* breadcrumbs */}
          <div className="mt-3 flex items-center justify-center text-[11px] text-blue-100/80 gap-2 font-sans font-bold">
            <Link href="/teacher"><a className="hover:underline">Dashboard</a></Link>
            <span>›</span>
            <Link href="/teacher/books"><a className="hover:underline">Books</a></Link>
            <span>›</span>
            <span className="text-white/90">Edit</span>
          </div>
        </div>
      </motion.div>

      <main className="flex-1 py-6 container mx-auto px-4 font-sans font-bold">
        {/* Back button */}
        <motion.div variants={fadeInFast} initial="hidden" animate="visible" className="mb-6">
          <Button
            variant="ghost"
            className="border-2 border-brand-navy-200 text-ilaw-navy hover:bg-brand-navy-50 font-sans font-bold"
            onClick={() => navigate("/teacher/books")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Books
          </Button>
        </motion.div>

        {/* Main card */}
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          className="border-2 border-brand-navy-200 bg-white rounded-2xl shadow-lg mb-16"
        >
          <div className="border-b border-brand-navy-200 p-4 rounded-t-2xl">
            <h3 className="text-xl font-sans font-bold text-ilaw-navy flex items-center">
              <Edit3 className="h-5 w-5 text-ilaw-gold mr-2" />
              📝 Edit Book Details
            </h3>
            <p className="text-sm text-brand-navy-700 mt-0.5 font-sans font-bold">
              Update book details and content
            </p>
          </div>

          <div className="p-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <motion.div
                  variants={stagger}
                  initial="hidden"
                  animate="visible"
                  className="grid grid-cols-1 lg:grid-cols-3 gap-4"
                >
                  {/* LEFT (2/3) */}
                  <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 auto-rows-min">
                    {/* Title */}
                    <motion.div variants={itemFade}>
                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem className="!space-y-1">
                            <FormLabel className="font-sans font-bold text-ilaw-navy">📖 Title</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Book title"
                                className="border-2 border-brand-navy-200 focus:border-ilaw-gold"
                                {...field}
                              />
                            </FormControl>
                            <p className="text-[11px] text-slate-500 mt-0.5 font-sans font-bold">
                              Keep it short and descriptive.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    {/* Type */}
                    <motion.div variants={itemFade}>
                      <FormField
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                          <FormItem className="!space-y-1">
                            <FormLabel className="font-sans font-bold text-ilaw-navy">📚 Book Type</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="border-2 border-brand-navy-200 focus:border-ilaw-gold font-sans font-bold">
                                  <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="border-2 border-brand-navy-200 font-sans font-bold">
                                <SelectItem value="storybook">📖 Storybook</SelectItem>
                                <SelectItem value="educational">🎓 Educational</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    {/* Subject (conditional) */}
                    <AnimatePresence initial={false} mode="popLayout">
                      {form.watch("type") === "educational" && (
                        <motion.div
                          key="subject-field"
                          variants={itemFade}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          className="md:col-span-2"
                        >
                          <FormField
                            control={form.control}
                            name="subject"
                            render={({ field }) => (
                              <FormItem className="!space-y-1">
                                <FormLabel className="font-sans font-bold text-ilaw-navy">📋 Subject Category</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger className="border-2 border-brand-navy-200 focus:border-ilaw-gold font-sans font-bold">
                                      <SelectValue placeholder="Select subject category" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent className="border-2 border-brand-navy-200 font-sans font-bold">
                                    <SelectItem value="GMRC">GMRC</SelectItem>
                                    <SelectItem value="Jolly Phonics (English Reading)">Jolly Phonics (English Reading)</SelectItem>
                                    <SelectItem value="Makabansa">Makabansa</SelectItem>
                                    <SelectItem value="English (language)">English (language)</SelectItem>
                                    <SelectItem value="Mathematics">Mathematics</SelectItem>
                                    <SelectItem value="Filipino">Filipino</SelectItem>
                                    <SelectItem value="Science">Science</SelectItem>
                                    <SelectItem value="English grammar">English grammar</SelectItem>
                                    <SelectItem value="Reading comprehension">Reading comprehension</SelectItem>
                                    <SelectItem value="Marungko">Marungko</SelectItem>
                                    <SelectItem value="MAPEH">MAPEH</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-[11px] text-slate-500 mt-0.5 font-sans font-bold">
                                  Required for educational books.
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Grade */}
                    <motion.div variants={itemFade}>
                      <FormField
                        control={form.control}
                        name="grade"
                        render={({ field }) => (
                          <FormItem className="!space-y-1">
                            <FormLabel className="font-sans font-bold text-ilaw-navy">🎓 Grade Level</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="border-2 border-brand-navy-200 focus:border-ilaw-gold font-sans font-bold">
                                  <SelectValue placeholder="Select grade" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="border-2 border-brand-navy-200 font-sans font-bold">
                                <SelectItem value="K">🌟 Kindergarten</SelectItem>
                                <SelectItem value="1">1️⃣ Grade 1</SelectItem>
                                <SelectItem value="2">2️⃣ Grade 2</SelectItem>
                                <SelectItem value="3">3️⃣ Grade 3</SelectItem>
                                <SelectItem value="4">4️⃣ Grade 4</SelectItem>
                                <SelectItem value="5">5️⃣ Grade 5</SelectItem>
                                <SelectItem value="6">6️⃣ Grade 6</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    {/* Quiz Mode */}
                    <motion.div variants={itemFade} className="md:col-span-2">
                      <FormField
                        control={form.control}
                        name="quizMode"
                        render={({ field }) => (
                          <FormItem className="!space-y-1">
                            <FormLabel className="font-sans font-bold text-ilaw-navy">🧠 Quiz Mode</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger className="border-2 border-brand-navy-200 focus:border-ilaw-gold font-sans font-bold">
                                  <SelectValue placeholder="Select quiz mode" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="border-2 border-brand-navy-200 font-sans font-bold">
                                <SelectItem value="retry">🔁 Retry (allow re-attempts)</SelectItem>
                                <SelectItem value="straight">➡️ Straight (no re-tries)</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-slate-500 mt-0.5 font-sans font-bold">
                              Controls how students can attempt the quiz.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    {/* Music URL + upload */}
                    <motion.div variants={itemFade} className="md:col-span-2">
                      <FormField
                        control={form.control}
                        name="musicUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-sans font-bold text-ilaw-navy">
                              🎵 Background Music URL (optional)
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="https://example.com/music.mp3"
                                className="border-2 border-brand-navy-200 focus:border-ilaw-gold"
                                {...field}
                                disabled={audioUploading}
                              />
                            </FormControl>
                            <div className="mt-2">
                              <Input
                                type="file"
                                accept="audio/*"
                                className="border-2 border-brand-navy-200 focus:border-ilaw-gold"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    setAudioUploading(true);
                                    const data = await uploadToCloudinary(file, "ilaw-ng-bayan/books/audio", "page_audio");
                                    field.onChange(data.url);
                                    toast({ title: "Audio uploaded", description: "Background music uploaded successfully." });
                                  } catch (err: any) {
                                    toast({
                                      title: "Upload failed",
                                      description: err?.message || "Could not upload audio file.",
                                      variant: "destructive",
                                    });
                                  } finally {
                                    setAudioUploading(false);
                                  }
                                }}
                                disabled={audioUploading}
                              />
                              {audioUploading && (
                                <p className="text-[11px] text-slate-500 mt-1 font-sans font-bold">
                                  Uploading audio…
                                </p>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    {/* Description */}
                    <motion.div variants={itemFade} className="md:col-span-2">
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-sans font-bold text-ilaw-navy">📝 Description</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Enter book description"
                                className="min-h-[96px] border-2 border-brand-navy-200 focus:border-ilaw-gold"
                                {...field}
                              />
                            </FormControl>
                            <p className="text-[11px] text-slate-500 mt-0.5 font-sans font-bold">
                              A brief overview students will see.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    {/* Badges & Award Rules */}
                    <motion.div
                      variants={itemFade}
                      className="md:col-span-2 border-2 border-brand-navy-200 bg-brand-navy-50 rounded-xl p-4 mt-1.5"
                    >
                      <h3 className="text-lg font-sans font-bold mb-3 text-ilaw-navy">🏅 Badges & Award Rules</h3>

                      {isLoadingBadges || isLoadingBookBadges ? (
                        <div className="bg-white p-4 rounded-xl text-center border-2 border-brand-navy-200">
                          <Loader2 className="h-5 w-5 animate-spin inline-block mr-2 text-ilaw-gold" />
                          <span className="text-brand-navy-700 font-sans font-bold">Loading badges...</span>
                        </div>
                      ) : allBadges.length === 0 ? (
                        <div className="bg-white p-4 rounded-xl text-center border-2 border-brand-navy-200">
                          <p className="text-brand-navy-700 font-sans font-bold">No badges available.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <AnimatePresence initial={false}>
                            {allBadges.map((b) => {
                              const m = badgeMappings[b.id];
                              return (
                                <motion.div
                                  key={b.id}
                                  variants={itemFade}
                                  initial="hidden"
                                  animate="visible"
                                  exit="exit"
                                  className="bg-white p-3 rounded-xl border-2 border-brand-navy-200"
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="font-sans font-bold text-ilaw-navy">{b.name}</p>
                                      {b.description ? (
                                        <p className="text-sm text-brand-navy-700 font-sans font-bold">{b.description}</p>
                                      ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Checkbox
                                        checked={!!m?.isEnabled}
                                        onCheckedChange={(v) =>
                                          setBadgeMappings((prev) => ({
                                            ...prev,
                                            [b.id]: {
                                              ...(prev[b.id] ?? {
                                                badgeId: b.id,
                                                isEnabled: false,
                                                awardMethod: "auto_on_book_complete",
                                                completionThreshold: 100,
                                              }),
                                              isEnabled: Boolean(v),
                                            },
                                          }))
                                        }
                                      />
                                      <span className="text-sm text-ilaw-navy font-sans font-bold">Enabled</span>
                                    </div>
                                  </div>

                                  <AnimatePresence initial={false} mode="popLayout">
                                    {m?.isEnabled && (
                                      <motion.div
                                        key={`badge-extra-${b.id}`}
                                        variants={itemFade}
                                        initial="hidden"
                                        animate="visible"
                                        exit="exit"
                                        className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3"
                                      >
                                        <div className="md:col-span-1">
                                          <label className="block text-sm font-sans font-bold text-ilaw-navy mb-1">
                                            Award Method
                                          </label>
                                          <Select
                                            value={m.awardMethod}
                                            onValueChange={(v: "auto_on_book_complete" | "manual") =>
                                              setBadgeMappings((prev) => ({
                                                ...prev,
                                                [b.id]: { ...(prev[b.id] as BookBadgeMapping), awardMethod: v },
                                              }))
                                            }
                                          >
                                            <SelectTrigger className="border-2 border-brand-navy-200 focus:border-ilaw-gold font-sans font-bold">
                                              <SelectValue placeholder="Select method" />
                                            </SelectTrigger>
                                            <SelectContent className="border-2 border-brand-navy-200 font-sans font-bold">
                                              <SelectItem value="auto_on_book_complete">Auto on Book Complete</SelectItem>
                                              <SelectItem value="manual">Manual</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>

                                        <div className="md:col-span-1">
                                          <label className="block text-sm font-sans font-bold text-ilaw-navy mb-1">
                                            % Completion Threshold
                                          </label>
                                          <Input
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={m.completionThreshold}
                                            onChange={(e) =>
                                              setBadgeMappings((prev) => ({
                                                ...prev,
                                                [b.id]: {
                                                  ...(prev[b.id] as BookBadgeMapping),
                                                  completionThreshold: Math.max(
                                                    1,
                                                    Math.min(100, Number(e.target.value || 0))
                                                  ),
                                                },
                                              }))
                                            }
                                            className="border-2 border-brand-navy-200 focus:border-ilaw-gold"
                                          />
                                          <p className="text-[11px] text-brand-navy-700 mt-0.5 font-sans font-bold">
                                            Used only if method is <b>Auto on Book Complete</b>.
                                          </p>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  </div>

                  {/* RIGHT (1/3): Cover image block */}
                  <motion.div variants={itemFade} className="lg:col-span-1">
                    <div className="rounded-xl border-2 border-brand-navy-200 bg-brand-navy-50 p-3 h-full">
                      <div className="flex items-center gap-2 mb-2">
                        <ImageIcon className="h-5 w-5 text-ilaw-navy" />
                        <h4 className="font-sans font-bold text-ilaw-navy">Cover Image</h4>
                      </div>

                      {form.watch("coverImage") ? (
                        <div className="mb-2">
                          <img
                            src={form.watch("coverImage")!}
                            alt="Cover preview"
                            className="w-full aspect-[3/4] object-cover rounded-lg border border-brand-navy-200"
                          />
                        </div>
                      ) : (
                        <div className="mb-2 aspect-[3/4] rounded-lg border-2 border-dashed border-brand-navy-200 bg-white/70 flex items-center justify-center text-sm text-brand-navy-700">
                          No cover selected
                        </div>
                      )}

                      {/* Hidden field for publicId so we can submit both */}
                      <FormField control={form.control} name="coverPublicId" render={({ field }) => (<input type="hidden" {...field} />)} />

                      <FormField
                        control={form.control}
                        name="coverImage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sr-only">Cover Image URL</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="https://example.com/image.jpg"
                                className="border-2 border-brand-navy-200 focus:border-ilaw-gold"
                                {...field}
                                disabled={coverUploading}
                                onChange={(e) => {
                                  // if the user types/pastes a URL manually, clear publicId
                                  field.onChange(e.target.value);
                                  form.setValue("coverPublicId", "");
                                }}
                              />
                            </FormControl>
                            <div className="mt-2">
                              <Input
                                type="file"
                                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                                className="border-2 border-brand-navy-200 focus:border-ilaw-gold"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    setCoverUploading(true);
                                    const { url, publicId } = await uploadToCloudinary(
                                      file,
                                      "ilaw-ng-bayan/books/covers",
                                      "book_cover"
                                    );
                                    // 👇 set BOTH fields so backend Zod pair check passes
                                    form.setValue("coverImage", url, { shouldDirty: true });
                                    form.setValue("coverPublicId", publicId ?? "", { shouldDirty: true });
                                    toast({ title: "Cover uploaded", description: "Cover image uploaded successfully." });
                                  } catch (err: any) {
                                    toast({
                                      title: "Upload failed",
                                      description: err?.message || "Could not upload cover image.",
                                      variant: "destructive",
                                    });
                                  } finally {
                                    setCoverUploading(false);
                                  }
                                }}
                                disabled={coverUploading}
                              />
                              {coverUploading && <p className="text-[11px] text-slate-500 mt-1">Uploading cover…</p>}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </motion.div>
                </motion.div>

                {/* Pages */}
                <motion.div variants={itemFade} initial="hidden" animate="visible" className="border-2 border-brand-navy-200 bg-brand-navy-50 rounded-xl p-4">
                  <h3 className="text-lg font-sans font-bold mb-3 text-ilaw-navy flex items-center">
                    <BookOpen className="h-5 w-5 text-ilaw-navy mr-2" />
                    📄 Book Pages
                  </h3>

                  {pages.length === 0 ? (
                    <motion.div variants={itemFade} initial="hidden" animate="visible" className="bg-white p-6 rounded-xl text-center border-2 border-brand-navy-200">
                      <p className="text-brand-navy-700 font-sans font-bold mb-3">📝 No pages added yet</p>
                      <Button
                        type="button"
                        onClick={handleAddPage}
                        className="bg-ilaw-gold hover:bg-brand-gold-600 text-ilaw-navy font-sans font-bold transition-transform hover:-translate-y-0.5"
                      >
                        <Plus className="h-4 w-4 mr-2" /> ✨ Add First Page
                      </Button>
                    </motion.div>
                  ) : (
                    <div className="space-y-4">
                      <AnimatePresence initial={false}>
                        {pages
                          .sort((a, b) => a.pageNumber - b.pageNumber)
                          .map((page) => (
                            <motion.div key={page.pageNumber} variants={itemFade} initial="hidden" animate="visible" exit="exit" layout>
                              <PageForm
                                initialValues={page}
                                pageNumber={page.pageNumber}
                                onSave={handlePageSave}
                                onRemove={() => handleRemovePage(page.pageNumber)}
                                showRemoveButton={pages.length > 1}
                              />
                            </motion.div>
                          ))}
                      </AnimatePresence>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddPage}
                        className="w-full py-5 border-2 border-brand-navy-200 text-ilaw-navy hover:bg-brand-navy-50 font-sans font-bold transition-transform hover:-translate-y-0.5"
                      >
                        <Plus className="h-4 w-4 mr-2" /> ✨ Add Another Page
                      </Button>
                    </div>
                  )}
                </motion.div>

                {/* spacer so sticky bar doesn't overlap */}
                <div className="h-6" />
              </form>
            </Form>
          </div>
        </motion.div>

        {/* Sticky Action Bar */}
        <motion.div variants={fadeInFast} initial="hidden" animate="visible" className="sticky bottom-4">
          <div className="container max-w-5xl mx-auto">
            <div className="rounded-xl border-2 border-brand-navy-200 bg-white/90 backdrop-blur p-3 shadow-lg flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/teacher/books")}
                className="border-2 border-brand-navy-200 text-ilaw-navy hover:bg-brand-navy-50 font-sans font-bold"
              >
                Cancel
              </Button>
              <Button
                onClick={form.handleSubmit(onSubmit)}
                disabled={isSaving}
                className="min-w-[140px] bg-gradient-to-r from-brand-gold-500 to-ilaw-gold hover:from-ilaw-gold hover:to-brand-gold-600 text-ilaw-navy font-sans font-bold"
              >
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                💾 Save Changes
              </Button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
