'use client'

import {
    Card,
    CardHeader,
    CardContent,
    CardDescription,
    CardTitle,
  } from "./ui/card";
  import { useScramble } from 'use-scramble';
  interface Props {
    title: string;
    description: string;
    number : string;
    text_size: string;
  }
  
  export function NumberCard({
    title,
    description,
    number,
    text_size,
  }: Props) {
    const styles = `
    .glow {
      transition: box-shadow 0.3s ease-in-out;
    }
  
    .glow:hover {
      box-shadow: 0 0 20px 2px rgba(0, 0, 0, 0.15); /* Adjust the glow effect */
    }
  `;

  const { ref } = useScramble({
    text: number,
    speed: 0.3,
    tick: 2,
    step: 1,
    scramble: 4,
    seed: 0,
  });
  
    return (
      <>
        <style>{styles}</style>
        <Card className="glow flex flex-col overflow-hidden border p-3 dark:bg-secondary p-3">
          <CardHeader className="">
            <div className="items-center space-y-1">
              <div className="inline-flex w-full items-center gap-1">
                <CardTitle className="inline-flex w-full items-center text-base">
                    {title}
                </CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">
                {description}
              </CardDescription>
            </div>
          </CardHeader>
          {(text_size === "md") ?
          <CardContent className="mt-auto font-bold flex text-md">
          <p ref={ref}></p>
        </CardContent> : null
        }
        {(text_size === "lg") ?
          <CardContent className="mt-auto font-bold flex text-5xl">
          <p ref={ref}></p>
        </CardContent> : null
        }
          
        </Card>
      </>
    );
  }
  