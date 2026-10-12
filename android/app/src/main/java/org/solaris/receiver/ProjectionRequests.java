package org.solaris.receiver;

/** Owns one consent/service/capture attempt without reusing a consent result. */
final class ProjectionRequests {
 static final int FIRST_CODE=2000,LAST_CODE=65534;
 static final class Request {
  final String ticket,broadcast;
  final int code;
  private boolean approved;
  Request(String ticket,String broadcast,int code){this.ticket=ticket;this.broadcast=broadcast;this.code=code;}
 }
 private int nextCode=FIRST_CODE;
 private Request pending;
 void restoreNextCode(int code){if(code>=FIRST_CODE&&code<=LAST_CODE+1)nextCode=Math.max(nextCode,code);}
 int nextCode(){return nextCode;}
 Request begin(String ticket,String broadcast){
  if(pending!=null)throw new IllegalStateException("화면공유 시작이 진행 중입니다.");
  if(ticket==null||ticket.isEmpty()||broadcast==null||broadcast.isEmpty())throw new IllegalArgumentException("화면공유 요청 정보가 없습니다.");
  if(nextCode>LAST_CODE)throw new IllegalStateException("화면공유 요청을 새로 만들려면 앱을 다시 여세요.");
  return pending=new Request(ticket,broadcast,nextCode++);
 }
 Request permission(int code){
  if(pending==null||pending.code!=code||pending.approved)return null;
  pending.approved=true;return pending;
 }
 boolean current(Request request){return request!=null&&pending==request;}
 boolean complete(Request request){if(!current(request))return false;pending=null;return true;}
 Request cancel(){Request old=pending;pending=null;return old;}
 Request pending(){return pending;}
 static boolean permissionCode(int code){return code>=FIRST_CODE&&code<=LAST_CODE;}
}
