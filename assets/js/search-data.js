// get the ninja-keys element
const ninja = document.querySelector('ninja-keys');

// add the home and posts menu items
ninja.data = [{
    id: "nav-about",
    title: "About",
    section: "Navigation",
    handler: () => {
      window.location.href = "/";
    },
  },{id: "nav-blog",
          title: "Blog",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/blog/";
          },
        },{id: "nav-publications",
          title: "Publications",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/publications/";
          },
        },{id: "nav-projects",
          title: "Projects",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/projects/";
          },
        },{id: "nav-resume",
          title: "Resume",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/resume/";
          },
        },{id: "books-the-godfather",
          title: 'The Godfather',
          description: "",
          section: "Books",handler: () => {
              window.location.href = "/books/the_godfather/";
            },},{id: "news-i-contributed-to-my-first-paper-roboauto-autonomous-robot-program-search-through-multi-level-physical-understanding-which-is-now-out-on-arxiv",
          title: 'I contributed to my first paper RoboAuto: Autonomous Robot Program Search through Multi-Level...',
          description: "",
          section: "News",},{id: "projects-project-2",
          title: 'project 2',
          description: "a project with a background image and giscus comments",
          section: "Projects",handler: () => {
              window.location.href = "/projects/2_project/";
            },},{id: "projects-project-3-with-very-long-name",
          title: 'project 3 with very long name',
          description: "a project that redirects to another website",
          section: "Projects",handler: () => {
              window.location.href = "/projects/3_project/";
            },},{id: "projects-project-4",
          title: 'project 4',
          description: "another without an image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/4_project/";
            },},{id: "projects-project-5",
          title: 'project 5',
          description: "a project with a background image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/5_project/";
            },},{id: "projects-project-6",
          title: 'project 6',
          description: "a project with no image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/6_project/";
            },},{id: "projects-project-7",
          title: 'project 7',
          description: "with background image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/7_project/";
            },},{id: "projects-project-8",
          title: 'project 8',
          description: "an other project with a background image and giscus comments",
          section: "Projects",handler: () => {
              window.location.href = "/projects/8_project/";
            },},{id: "projects-project-9",
          title: 'project 9',
          description: "another project with an image 🎉",
          section: "Projects",handler: () => {
              window.location.href = "/projects/9_project/";
            },},{id: "projects-bank-app",
          title: 'Bank App',
          description: "A school project for CSE 233 (Programming Tools and Techniques) to develop a banking application in Java using software development best practices",
          section: "Projects",handler: () => {
              window.location.href = "/projects/bank_app/";
            },},{id: "projects-chorus",
          title: 'Chorus',
          description: "A school project for CSE 204 (Web Development) at WashU to have LLMs debate on ideas in a multi-agent system, with a React (Typescript) frontend and Fast API (Python) backend",
          section: "Projects",handler: () => {
              window.location.href = "/projects/chorus/";
            },},{id: "projects-delivery",
          title: 'Delivery',
          description: "A collaboration between WashU Robotics and WashU GDG to employ an on-campus delivery robot to deliver products from food vendors to clients",
          section: "Projects",handler: () => {
              window.location.href = "/projects/delivery/";
            },},{id: "projects-introduction-to-llms",
          title: 'Introduction to LLMs',
          description: "A personal project to teach others about the basics behind the theory and applications of LLMs",
          section: "Projects",handler: () => {
              window.location.href = "/projects/introduction_to_llms/";
            },},{id: "projects-local-llm-council",
          title: '(Local) LLM Council',
          description: "A personal project forked off of Andrej Karpathy&#39;s vibe-coded LLM Council project to add support for local LLMs",
          section: "Projects",handler: () => {
              window.location.href = "/projects/llm_council/";
            },},{id: "projects-nimble",
          title: 'Nimble',
          description: "Using embodied AI models to perform out-of-distribution generalization on human manipulation tasks for WashU Robotics.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/nimble/";
            },},{id: "projects-preventing-manipulation-of-prediction-markets",
          title: 'Preventing Manipulation of Prediction Markets',
          description: "Providing insights on how prediction markets with multiple agents can be made resilient to adversarial manipulation through liquidity depth and fee structures for CSE 516 (Multi-Agent Systems) at WashU.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/prediction_market/";
            },},{id: "projects-quarantine-influence-minimization-of-unaligned-behaviors-in-an-agentic-swarm",
          title: 'Quarantine! Influence Minimization of Unaligned Behaviors in an Agentic Swarm',
          description: "Influence minimization of unaligned agents in a multi-agent AI system for CSE 4106 (Data Science for Complex Networks) and inspired by LING 2550 (Methods for Linguistics Research) at WashU.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/quarantine/";
            },},{id: "projects-identifai",
          title: 'IdentifAI',
          description: "A real-world implementation of SynthID text watermarking for CSE 330 at WashU, including generation and Bayesian detection with Google&#39;s Gemma-3-1B-IT.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/watermarking/";
            },},{id: "teachings-data-science-fundamentals",
          title: 'Data Science Fundamentals',
          description: "This course covers the foundational aspects of data science, including data collection, cleaning, analysis, and visualization. Students will learn practical skills for working with real-world datasets.",
          section: "Teachings",handler: () => {
              window.location.href = "/teachings/data-science-fundamentals/";
            },},{id: "teachings-introduction-to-machine-learning",
          title: 'Introduction to Machine Learning',
          description: "This course provides an introduction to machine learning concepts, algorithms, and applications. Students will learn about supervised and unsupervised learning, model evaluation, and practical implementations.",
          section: "Teachings",handler: () => {
              window.location.href = "/teachings/introduction-to-machine-learning/";
            },},{
        id: 'social-email',
        title: 'email',
        section: 'Socials',
        handler: () => {
          window.open("mailto:%74%79%6C%65%72%64%69%6E%68%31%34@%67%6D%61%69%6C.%63%6F%6D", "_blank");
        },
      },{
        id: 'social-linkedin',
        title: 'LinkedIn',
        section: 'Socials',
        handler: () => {
          window.open("https://www.linkedin.com/in/dinhtyler", "_blank");
        },
      },{
        id: 'social-scholar',
        title: 'Google Scholar',
        section: 'Socials',
        handler: () => {
          window.open("https://scholar.google.com/citations?user=ofPzlgYAAAAJ", "_blank");
        },
      },{
      id: 'light-theme',
      title: 'Change theme to light',
      description: 'Change the theme of the site to Light',
      section: 'Theme',
      handler: () => {
        setThemeSetting("light");
      },
    },
    {
      id: 'dark-theme',
      title: 'Change theme to dark',
      description: 'Change the theme of the site to Dark',
      section: 'Theme',
      handler: () => {
        setThemeSetting("dark");
      },
    },
    {
      id: 'system-theme',
      title: 'Use system default theme',
      description: 'Change the theme of the site to System Default',
      section: 'Theme',
      handler: () => {
        setThemeSetting("system");
      },
    },];
