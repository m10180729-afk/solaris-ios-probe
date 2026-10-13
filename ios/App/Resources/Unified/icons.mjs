// Small, bundled SVG controls: no remote font or image dependency.
const iconPaths={
 friends:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
 message:['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3H12a9 9 0 0 1 9 8.5','M7 9h8','M7 13h6'],
 screen:['M3 4h18v12H3z','M8 21h8','M12 16v5','M8 10l4-4 4 4','M12 6v7'],
 files:['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z','M14 2v6h6','M8 13h8','M8 17h6'],
 settings:['M9.5 3h5l.6 2.4 2.1 1.2 2.4-.7 2.5 4.3-1.8 1.7v2.4l1.8 1.7-2.5 4.3-2.4-.7-2.1 1.2-.6 2.4h-5l-.6-2.4-2.1-1.2-2.4.7-2.5-4.3 1.8-1.7v-2.4L2 9.5l2.5-4.3 2.4.7L9 4.7z','M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
 user:['M20 21v-2a7 7 0 0 0-14 0v2','M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
 members:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M20 8v6','M17 11h6'],
 menu:['M4 6h16','M4 12h16','M4 18h16'],more:['M5 12h.01','M12 12h.01','M19 12h.01'],
 chevron:['M6 9l6 6 6-6'],plus:['M12 5v14','M5 12h14'],close:['M6 6l12 12','M6 18 18 6'],
 send:['M22 2 9 15','M22 2-7 20-4-9-9-4z'],search:['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16','M17 17l5 5'],
 leave:['M9 3H4v18h5','M10 12h12','M18 8l4 4-4 4'],hash:['M4 9h16','M3 15h16','M10 3 6 21','M18 3l-4 18'],
 full:['M8 3H3v5','M16 3h5v5','M21 16v5h-5','M8 21H3v-5'],stop:['M6 6h12v12H6z'],
 check:['M20 6 9 17l-5-5'],
 minimize:['M5 17h14'],maximize:['M5 5h14v14H5z'],restore:['M8 3h13v13','M3 8h13v13H3z'],
 signal:['M4 20v-4','M9 20v-8','M14 20V8','M19 20V4']
};
// Filled navigation silhouettes and outline utility controls share a 24px grid.
// These generic Solaris glyphs are authored here; no Discord brand artwork.
const filledPaths={
 friends:['M8.5 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z','M2 19a6.5 6.5 0 0 1 13 0v2H2Z','M16 3.5a4 4 0 0 1 0 8V3.5Z','M17 14a5 5 0 0 1 5 5v2h-5v-7Z'],
 message:['M5 3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9l-5.5 3v-3A3 3 0 0 1 2 16V6a3 3 0 0 1 3-3Z'],
 user:['M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z','M3 21a9 9 0 0 1 18 0H3Z'],
 files:['M5 2h9v6h6v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z','M16 2.5 20.5 7H16Z'],
 more:['M5 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z','M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z','M19 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z'],
 stop:['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z'],
 send:['M2 2 23 12 2 22l3-9 10-1-10-1Z']
};
export function icon(name,size=20){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 for(const[k,v]of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'ui-icon'}))svg.setAttribute(k,v);
 const filled=filledPaths[name];if(filled){svg.setAttribute('fill','currentColor');svg.setAttribute('stroke','none');}
 for(const d of filled??iconPaths[name]??iconPaths.message){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}
