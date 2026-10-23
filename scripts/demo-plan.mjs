// Pure data only. Importing this module never opens a database or writes a file.
export function demoPlan(){
 const events=[{day:0,type:'sayim',items:{coffee:10000,milk:40000,cup:300}}];
 const stock={coffee:10000,milk:40000,cup:300};
 for(let day=1;day<=28;day++){
  if(day%7===1){events.push({day,type:'fatura',items:{coffee:5000,milk:40000,cup:300}});stock.coffee+=5000;stock.milk+=40000;stock.cup+=300;}
  events.push({day,type:'satis',items:{latte:20,espresso:10}});
  events.push({day,type:'fire',items:{coffee:10,milk:100}});
  stock.coffee-=550;stock.milk-=4100;stock.cup-=30;
  if(day===21)stock.milk-=12000;
  if(day%7===0)events.push({day,type:'sayim',items:{...stock}});
 }
 return events;
}
