import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { GlobeIcon, MailIcon, PhoneIcon, Headphones, Undo, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RESUME_DATA } from "@/data/resume-data";

import { ThemeProvider } from "@/components/ui/theme-provider";
import Image from "next/image";
import { NumberCard } from "@/components/number-card";
import { Card } from "@/components/ui/card";
//import { ProjectCard } from "@/components/project-card";
import { TutorCard } from "@/components/tutor-card";

export const metadata: Metadata = {
  title: `Tyler Dinh`,
  description: "Hi, I’m Tyler, a current student at Washington University in St. Louis. Throughout my time there, I’ve enjoyed math and computer science, and now I hope to help high school students achieve their full potential in these areas. With a strong background in mathematics, computer science, and engineering, my services range from AP to college-level classes. A more detailed overview of my services can be found below.",
};

export default function Page() {
  return (
    <ThemeProvider
          attribute="class"
          defaultTheme=""
          enableSystem
          disableTransitionOnChange
        >
    <main className="relative mx-auto w-full scroll-my-12 overflow-auto p-4 print:p-12 md:p-16 dark:bg-gray-950">
      <section className="mx-auto w-full max-w-2xl space-y-8 bg-white print:space-y-6 dark:bg-gray-950">
        <div className="flex items-center justify-between">
          <div className="flex-1 space-y-2">
            <Avatar className="mb-8 size-40 sm:hidden">
              <AvatarImage alt="Tyler Dinh" src={RESUME_DATA.tutoringAvatarUrl} />
              <AvatarFallback>Tyler Dinh</AvatarFallback>
            </Avatar>
            <h1 className="text-3xl font-bold">Tyler Dinh</h1>
            <p className="max-w-md items-center text-pretty font-mono text-sm text-muted-foreground">
              <a
                className="inline-flex gap-x-1.5 align-baseline leading-none hover:underline"
                href={RESUME_DATA.locationLink}
                target="_blank"
              >
                <GlobeIcon className="size-3" />
                {RESUME_DATA.location}
              </a>
            </p>
            <div className="flex gap-x-1 pt-1 font-mono text-sm text-muted-foreground print:hidden">
              {RESUME_DATA.contact.email ? (
                <Button
                  className="size-10"
                  variant="outline"
                  size="icon"
                  asChild
                >
                  <a href={`mailto:${RESUME_DATA.contact.email}`}>
                    <MailIcon className="size-5" />
                  </a>
                </Button>
              ) : null}
              {RESUME_DATA.contact.tutoring ? (
                <Button
                  key={RESUME_DATA.contact.tutoring.name}
                  className="size-10"
                  variant="outline"
                  size="icon"
                  asChild
                >
                  <a href="/">
                    <Undo2Icon className="size-5" />
                  </a>
                </Button>
              ) : null}
            </div>
            <div className="hidden flex-col gap-x-1 font-mono text-sm text-muted-foreground print:flex">
              {RESUME_DATA.contact.email ? (
                <a href={`mailto:${RESUME_DATA.contact.email}`}>
                  <span className="underline">{RESUME_DATA.contact.email}</span>
                </a>
              ) : null}
            </div>
          </div>
          <Avatar className="hidden size-40 sm:block">
            <AvatarImage alt={RESUME_DATA.name} src={RESUME_DATA.tutoringAvatarUrl} />
            <AvatarFallback>{RESUME_DATA.initials}</AvatarFallback>
          </Avatar>
        </div>
        <Section>
          <h2 className="text-xl font-bold">About</h2>
          <p className="text-pretty font-mono text-sm text-muted-foreground">
            {RESUME_DATA.tutoringSummary}
          </p>
        </Section>

        {/* <Section>
          <h2 className="text-xl font-bold">Experience</h2>
          <div className="-mx-1 grid grid-cols-1 gap-3 print:grid-cols-3 print:gap-2 md:grid-cols-2 lg:grid-cols-3 ">
           <NumberCard
                  key="Number of Students"
                  title="Number of Students"
                  description="both current and prior"
                  number="26"
                  text_size="lg"
                />
            <NumberCard
                  key="Average Grade Increase"
                  title="Average Grade Increase"
                  description="meaured across all students"
                  number="~15%"
                  text_size="lg"
                />
            <NumberCard
                  key=""
                  title="Workshops Hosted"
                  description="200+ student sessions"
                  number="4"
                  text_size="lg"
                />
                </div>
        </Section> */}

        <Section>
          <h2 className="text-xl font-bold">Subjects</h2>
          <p className="text-pretty font-mono text-sm text-muted-foreground">For previous students, my help with these subjects typically involved assisting with an existing course or creating a custom, 10 week curriculum.</p>
          <div className="-mx-1 grid grid-cols-1 gap-3 print:grid-cols-4 print:gap-2 md:grid-cols-2 lg:grid-cols-4">
            {RESUME_DATA.tutoringServices.map((service) => (
              <TutorCard
                key={service}
                title={service}
                description=""
                isProject
              />
            ))}
              

          </div>
        
        </Section>

  

        <Section>
        <h2 className="text-xl font-bold">Contact</h2>
          <p className="text-pretty font-mono text-sm text-muted-foreground">
            {RESUME_DATA.tutoringContact}
          </p>

        </Section>
      </section>
    </main>
    </ThemeProvider>
  );
}