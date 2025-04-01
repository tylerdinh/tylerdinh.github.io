import {
    Card,
    CardHeader,
    CardContent,
    CardDescription,
    CardTitle,
  } from "./ui/card";
  import { Badge } from "./ui/badge";
  import { useEffect, useState } from "react";
  
  interface Props {
    title: string;
    description: string;
    link?: string;
    isProject?: boolean;
  }
  
    
  
  
  
  export function TutorCard({ title, description, link, isProject }: Props) {
  
    function getRandomColor() {
      const hue = Math.floor(Math.random() * 200) + 40; // Hues between 40° and 240°
      const saturation = Math.floor(Math.random() * 20) + 60; // Saturation: 60% to 80%
      const lightness = Math.floor(Math.random() * 20) + 50; // Lightness: 50% to 70%
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }
    
    const color = '#424651';
  
  
  
    const styles = `
    .glow {
      transition: box-shadow 0.3s ease-in-out;
    }
  
    .glow:hover {
      box-shadow: 0 0 20px 2px rgba(0, 0, 0, 0.15); /* Adjust the glow effect */
    }
    
  `;
  
    return (
      <>
      {isProject &&
      <style>{styles}</style>}
      <Card className="flex flex-col overflow-hidden border border-muted p-3 glow" style={{backgroundColor: color}}>
        <CardHeader className="">
          <div className="space-y-1">
            <CardTitle className="text-base" style={{ color: "#ffffff" }}>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {title}{" "}
                  <span className="size-1 rounded-full bg-green-500"></span>
                </a>
              ) : (
                title
              )}
            </CardTitle>
            <div className="hidden font-mono text-xs underline print:visible" style={{ color: "#215732" }}>
              {link?.replace("https://", "").replace("www.", "").replace("/", "")}
            </div>
            <CardContent className="mt-auto font-bold flex text-md mx-auto">
            <p className="mx-auto" style={{ color: "#215732" }}>{description}</p>
          </CardContent> 
           
          </div>
        </CardHeader>
        <CardContent className="mt-auto flex">
          <div className="mt-2 flex flex-wrap gap-1">
            {/* {tags.map((tag) => (
              <Badge
                className="px-1 py-0 text-[10px]"
                variant="secondary"
                key={tag}
              >
                {tag}
              </Badge>
            ))} */}
          </div>
        </CardContent>
      </Card>
      </>
    );
  }