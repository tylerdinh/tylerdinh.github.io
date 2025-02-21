import {
  ClevertechLogo,
  ConsultlyLogo,
  JojoMobileLogo,
  MonitoLogo,
  NSNLogo,
  ParabolLogo,
} from "@/images/logos";
import { GitHubIcon, LinkedInIcon,} from "@/components/icons";
import { GraduationCap } from "lucide-react";


export const RESUME_DATA = {
  name: "Tyler Dinh",
  initials: "TD",
  location: "Kansas City, MO",
  locationLink: "https://www.google.com/maps/place/Kansas+City,+MO",
  about:
    "CS at WashU",
  summary: (
    <>
      Computer Science student at Washington University in St. Louis with a strong interest 
      in software development and a passion for building innovative solutions.
    </>
  ),
  tutoringSummary: "Hi, I’m Tyler, a current student at Washington University in St. Louis. I hope to help high school students achieve their full potential in both computer science and math. A more detailed overview of my services can be found below.",
  tutoringServices: [
    "Algebra",
    "Geometry",
    "AP Calculus AB / Calculus 1",
    "AP Calculus BC / Calculus 2",
    "AP Statistics",
    "AP Computer Science Principles",
    "AP Computer Science A",
    "ACT Math",
    "SAT Math",

  ],
  tutoringContact: "If you are interested in tutoring, please contact me at dinh.t@wustl.edu. One free trial session is available for new students to see if I am a good fit for you.",
  avatarUrl: "/images/tylerdinh.jpg",
  tutoringAvatarUrl: "/images/tylerdinh.jpg",
  personalWebsiteUrl: "https://tylerdinhgithubio.vercel.app/",
  contact: {
    email: "dinh.t@wustl.edu",
    social: [
      {
        name: "GitHub",
        url: "https://github.com/tylerdinh",
        icon: GitHubIcon,
      },
      {
        name: "LinkedIn",
        url: "https://www.linkedin.com/in/dinhtyler/",
        icon: LinkedInIcon,
      }, 
      {
        name: "Tutoring",
        url: "/tutoring",
        icon: GraduationCap,
      }
    ],
    tutoring: {
      name: "Tyler",
      url: "/tutoring",
    }
  },
  education: [
    {
      school: "Washington University in St. Louis",
      degree: "Bachelor's Degree in Computer Science",
      start: "2024",
      end: "2028",
    },
  ],
  work: [
    {
      company: "Amazon",
      link: "https://amazon.com",
      badges: ["Java", "AWS"],
      title: "Software Development Engineer Intern",
      logo: ConsultlyLogo,
      start: "2024",
      end: 2028,
      description: (
        <>
          Incoming intern for Summer 2024.
        </>
      ),
    },
  ],
  skills: [
    "Java",
    "Python",
    "Robotics",
    "Computer Vision",
    "Machine Learning",
    "LaTeX"
  ],
  projects: [
    {
      title: "Word Wizard",
      techStack: ["Java", "Android Studio",],
      description:
        "Congressional App Challenge 2024 winner. An application that helps students learn vocabulary words through interactive games and quizzes.",
      logo: MonitoLogo,
      link: {
        label: "congressionalappchallenge.us",
        href: "https://www.congressionalappchallenge.us",
      },
    },
  ],
} as const;